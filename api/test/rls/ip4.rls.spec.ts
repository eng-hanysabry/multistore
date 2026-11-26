import { Pool } from 'pg';
import {
  Ctx,
  applyMigration,
  poolAs,
  run,
  seedId,
  setupDatabase,
  superClient,
} from './harness';

/**
 * IP-4 identity and tenancy against real PostgreSQL (spec 6.4 policy matrix, 6.6 role and
 * privilege model; corrections A-D of 26 Nov approval). Migrations are applied as
 * multistore_owner through the same path as deploy; seeds run as the superuser because
 * FORCE RLS binds the owner. API-level STM flows (HTTP DTOs, guards) arrive with steps 5-7;
 * this suite proves the database contract those flows will rely on.
 */

const TENANT_ALPHA = seedId(201); // alpha-shop, ACTIVE
const TENANT_BETA = seedId(202); // beta-shop, SUSPENDED
const USER_ACTIVE = seedId(203); // user1@example.com, ACTIVE
const USER_PENDING = seedId(204); // user2@example.com, PENDING_VERIFICATION
const USER_OTHER = seedId(205); // user3@example.com, ACTIVE
const MEMB_1 = seedId(206);
const MEMB_2 = seedId(207);
const SESSION_1 = seedId(208);
const RT_1 = seedId(209);
const CODE_1 = seedId(210);

let app: Pool;
let admin: Pool;
let owner: Pool;
let session1Expires: string;

const NEW_TABLES = [
  'tenants',
  'users',
  'memberships',
  'auth_codes',
  'sessions',
  'refresh_tokens',
  'audit_log',
];

async function seed(): Promise<void> {
  const s = superClient();
  await s.connect();
  try {
    await s.query(
      'TRUNCATE tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log CASCADE',
    );
    await s.query(
      'INSERT INTO tenants (id, code, name, status) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
      [TENANT_ALPHA, 'alpha-shop', 'Alpha', 'ACTIVE', TENANT_BETA, 'beta-shop', 'Beta', 'SUSPENDED'],
    );
    await s.query(
      'INSERT INTO users (id, email, password_hash, status) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)',
      [
        USER_ACTIVE, 'user1@example.com', 'h1', 'ACTIVE',
        USER_PENDING, 'user2@example.com', 'h2', 'PENDING_VERIFICATION',
        USER_OTHER, 'user3@example.com', 'h3', 'ACTIVE',
      ],
    );
    await s.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE'),($4,$2,$5,'MERCHANT','ACTIVE')",
      [MEMB_1, TENANT_ALPHA, USER_ACTIVE, MEMB_2, USER_OTHER],
    );
    const sess = await s.query(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days') RETURNING expires_at::text AS expires_at",
      [SESSION_1, USER_ACTIVE],
    );
    session1Expires = sess.rows[0]['expires_at'];
    await s.query(
      "INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, status, expires_at, session_expires_at) VALUES ($1,$2,$3,'tok1','ACTIVE', now() + interval '7 days', $4)",
      [RT_1, SESSION_1, USER_ACTIVE, session1Expires],
    );
    await s.query(
      "INSERT INTO auth_codes (id, user_id, purpose, code_hash, expires_at) VALUES ($1,$2,'VERIFY_EMAIL','code1', now() + interval '10 minutes')",
      [CODE_1, USER_PENDING],
    );
  } finally {
    await s.end();
  }
}

/** true when the statement is rejected (RLS, grants, CHECK or trigger) or matches zero rows. */
const blocked = async (pool: Pool, ctx: Ctx, sql: string, p: unknown[] = []): Promise<boolean> => {
  try {
    return (await run(pool, ctx, async (q) => (await q(sql, p)).rowCount)) === 0;
  } catch {
    return true;
  }
};

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  app = poolAs('multistore_app', 4);
  admin = poolAs('multistore_admin', 1);
  owner = poolAs('multistore_owner', 1);
});
afterAll(async () => {
  await Promise.all([app.end(), admin.end(), owner.end()]);
});
beforeEach(seed);

describe('IP-4 role and privilege model (6.6)', () => {
  it('RLS is enabled and forced on all 7 new tables', async () => {
    const r = await app.query(
      'SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity ORDER BY 1',
      [NEW_TABLES],
    );
    expect(r.rows.map((x) => x['relname'])).toEqual([...NEW_TABLES].sort());
  });

  it('table-level grants match the approved minimum exactly', async () => {
    // Catalog views show each role only its own grants: read them as the superuser.
    const s = superClient();
    await s.connect();
    const r = await s.query(
      `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name = ANY($1)
         AND grantee IN ('multistore_app','multistore_admin') ORDER BY 1,2,3`,
      [NEW_TABLES],
    );
    const got = r.rows.map((x) => `${x['grantee']}:${x['table_name']}:${x['privilege_type']}`);
    const want = [
      ['multistore_app', 'tenants', ['SELECT']],
      ['multistore_app', 'users', ['INSERT', 'SELECT']],
      ['multistore_app', 'memberships', ['SELECT']],
      ['multistore_app', 'auth_codes', ['INSERT', 'SELECT']],
      ['multistore_app', 'sessions', ['INSERT', 'SELECT']],
      ['multistore_app', 'refresh_tokens', ['INSERT', 'SELECT']],
      ['multistore_app', 'audit_log', ['INSERT']],
      ['multistore_admin', 'tenants', ['INSERT', 'SELECT', 'UPDATE']],
      // admin users SELECT is column-level only (id, email, status, created_at): it shows up in
      // column_privileges below, not as a table-level grant row here.
      ['multistore_admin', 'memberships', ['DELETE', 'INSERT', 'SELECT', 'UPDATE']],
      ['multistore_admin', 'audit_log', ['INSERT', 'SELECT']],
    ].flatMap(([g, t, ps]) => (ps as string[]).sort().map((p) => `${g}:${t}:${p}`));
    await s.end();
    expect(got).toEqual(want.sort());
  });

  it('correction B: UPDATE is column-restricted; immutable columns are not updatable', async () => {
    const s = superClient();
    await s.connect();
    const r = await s.query(
      `SELECT grantee, table_name, column_name FROM information_schema.column_privileges
       WHERE table_schema='public' AND privilege_type='UPDATE'
         AND grantee IN ('multistore_app','multistore_admin') AND table_name = ANY($1)
       ORDER BY 1,2,3`,
      [NEW_TABLES],
    );
    const got = r.rows.map((x) => `${x['grantee']}:${x['table_name']}:${x['column_name']}`);
    expect(got).toEqual([
      'multistore_app:auth_codes:attempts',
      'multistore_app:auth_codes:consumed_at',
      'multistore_app:refresh_tokens:replaced_by_id',
      'multistore_app:refresh_tokens:status',
      'multistore_app:sessions:revoked_at',
      'multistore_app:sessions:revoked_reason',
      'multistore_app:users:email_verified_at',
      'multistore_app:users:password_changed_at',
      'multistore_app:users:password_hash',
      'multistore_app:users:status',
      'multistore_app:users:updated_at',
      'multistore_admin:memberships:created_at',
      'multistore_admin:memberships:id',
      'multistore_admin:memberships:role',
      'multistore_admin:memberships:status',
      'multistore_admin:memberships:tenant_id',
      'multistore_admin:memberships:user_id',
      'multistore_admin:tenants:code',
      'multistore_admin:tenants:created_at',
      'multistore_admin:tenants:id',
      'multistore_admin:tenants:name',
      'multistore_admin:tenants:status',
      'multistore_admin:tenants:updated_at',
    ].sort());
    await s.end();
  });

  it('no grants to PUBLIC, anon, authenticated or service_role on the new tables', async () => {
    const s = superClient();
    await s.connect();
    const r = await s.query(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name = ANY($1)
         AND grantee IN ('PUBLIC','anon','authenticated','service_role')`,
      [NEW_TABLES],
    );
    await s.end();
    expect(r.rows[0]['n']).toBe(0);
  });

  it('admin cannot touch auth_codes, sessions or refresh_tokens at all', async () => {
    for (const t of ['auth_codes', 'sessions', 'refresh_tokens']) {
      await expect(admin.query(`SELECT id FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
    }
  });

  it('admin reads users without password_hash or other auth columns', async () => {
    const r = await admin.query('SELECT id, email, status, created_at FROM users ORDER BY email');
    expect(r.rows).toHaveLength(3);
    await expect(admin.query('SELECT password_hash FROM users')).rejects.toThrow(
      /permission denied/,
    );
    const s = superClient();
    await s.connect();
    const cols = await s.query(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE table_schema='public' AND table_name='users' AND grantee='multistore_admin'
         AND privilege_type='SELECT' ORDER BY 1`,
    );
    await s.end();
    expect(cols.rows.map((x) => x['column_name'])).toEqual([
      'created_at',
      'email',
      'id',
      'status',
    ]);
  });

  it('STM-19: multistore_admin is capped at 3 connections', async () => {
    const r = await app.query(
      "SELECT rolconnlimit::int AS n FROM pg_roles WHERE rolname='multistore_admin'",
    );
    expect(r.rows[0]['n']).toBe(3);
  });
});

describe('IP-4 tenants policies (6.4)', () => {
  it('no context: zero rows, no writes', async () => {
    expect((await app.query('SELECT id FROM tenants')).rowCount).toBe(0);
  });
  it('GUEST resolves an ACTIVE tenant by code only', async () => {
    expect(
      await run(app, { role: 'GUEST', tenantCode: 'alpha-shop' }, async (q) =>
        (await q('SELECT code FROM tenants')).rows.map((r) => r['code']),
      ),
    ).toEqual(['alpha-shop']);
    expect(
      await blocked(app, { role: 'GUEST', tenantCode: 'beta-shop' }, 'SELECT id FROM tenants'),
    ).toBe(true);
  });
  it('CUSTOMER/MERCHANT see their own ACTIVE tenant by id, never another', async () => {
    for (const role of ['CUSTOMER', 'MERCHANT']) {
      expect(
        await run(app, { role, tenant: TENANT_ALPHA }, async (q) =>
          (await q('SELECT id FROM tenants')).rows.map((r) => r['id']),
        ),
      ).toEqual([TENANT_ALPHA]);
      expect(
        await blocked(app, { role, tenant: TENANT_BETA }, 'SELECT id FROM tenants'),
      ).toBe(true);
    }
  });
  it('app cannot write tenants; admin can (approved minimum Phase 1)', async () => {
    expect(
      await blocked(
        app,
        { role: 'MERCHANT', tenant: TENANT_ALPHA },
        "UPDATE tenants SET name='x' WHERE id=$1",
        [TENANT_ALPHA],
      ),
    ).toBe(true);
    await expect(
      admin.query("UPDATE tenants SET name='Alpha2' WHERE id=$1", [TENANT_ALPHA]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('IP-4 users policies and the sensitive-field trigger (6.4, D-S2, correction C)', () => {
  it('GUEST login lookup matches only the exact login email', async () => {
    expect(
      await run(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, async (q) =>
        (await q('SELECT email FROM users')).rows.map((r) => r['email']),
      ),
    ).toEqual(['user1@example.com']);
    expect(
      await blocked(app, { role: 'GUEST', loginEmail: 'nobody@example.com' }, 'SELECT id FROM users'),
    ).toBe(true);
    expect(await blocked(app, { role: 'GUEST' }, 'SELECT id FROM users')).toBe(true);
  });

  it('register inserts only PENDING_VERIFICATION, never super admin', async () => {
    await run(app, { role: 'GUEST', loginEmail: 'new@example.com' }, async (q) => {
      expect(
        (
          await q(
            "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'new@example.com','h','PENDING_VERIFICATION')",
            [seedId(300)],
          )
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'evil@example.com' }, (q) =>
        q(
          "INSERT INTO users (id, email, password_hash, status, is_super_admin) VALUES ($1,'evil@example.com','h','PENDING_VERIFICATION',true)",
          [seedId(301)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'fast@example.com' }, (q) =>
        q(
          "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'fast@example.com','h','ACTIVE')",
          [seedId(302)],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('self-read for authenticated roles; other users stay invisible', async () => {
    for (const role of ['CUSTOMER', 'MERCHANT']) {
      expect(
        await run(app, { role, tenant: TENANT_ALPHA, user: USER_ACTIVE }, async (q) =>
          (await q('SELECT id FROM users')).rows.map((r) => r['id']),
        ),
      ).toEqual([USER_ACTIVE]);
    }
  });

  it('correction C: GUEST cannot self-activate without a consumed verification code', async () => {
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'user2@example.com' }, (q) =>
        q(
          "UPDATE users SET status='ACTIVE', email_verified_at=now(), updated_at=now() WHERE id=$1",
          [USER_PENDING],
        ),
      ),
    ).rejects.toThrow(/verification requires a consumed verification code/);
  });

  it('verification flow: consume the code, then activate, in one transaction', async () => {
    await run(app, { role: 'GUEST', loginEmail: 'user2@example.com' }, async (q) => {
      expect((await q('UPDATE auth_codes SET consumed_at=now() WHERE id=$1', [CODE_1])).rowCount).toBe(1);
      expect(
        (
          await q(
            "UPDATE users SET status='ACTIVE', email_verified_at=now(), updated_at=now() WHERE id=$1",
            [USER_PENDING],
          )
        ).rowCount,
      ).toBe(1);
    });
    const s = superClient();
    await s.connect();
    const r = await s.query('SELECT status, email_verified_at IS NOT NULL AS v FROM users WHERE id=$1', [
      USER_PENDING,
    ]);
    await s.end();
    expect(r.rows[0]).toEqual({ status: 'ACTIVE', v: true });
  });

  it('an authenticated user cannot change their own status or email_verified_at', async () => {
    for (const sql of [
      "UPDATE users SET status='DISABLED', updated_at=now() WHERE id=$1",
      'UPDATE users SET email_verified_at=now(), updated_at=now() WHERE id=$1',
    ]) {
      await expect(
        run(app, { role: 'CUSTOMER', tenant: TENANT_ALPHA, user: USER_ACTIVE }, (q) =>
          q(sql, [USER_ACTIVE]),
        ),
      ).rejects.toThrow(/verification flow|verification requires/);
    }
  });

  it('is_super_admin can never change via the app role', async () => {
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, (q) =>
        q('UPDATE users SET is_super_admin=true WHERE id=$1', [USER_ACTIVE]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('reviewed owner operations are not broken by the trigger', async () => {
    await expect(
      run(owner, {}, (q) =>
        q("UPDATE users SET status='DISABLED', updated_at=now() WHERE id=$1", [USER_ACTIVE]),
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('IP-4 memberships policies (6.4, STM-09 tenancy)', () => {
  it('MERCHANT sees own memberships across tenants; CUSTOMER only within own tenant', async () => {
    expect(
      await run(app, { role: 'MERCHANT', user: USER_ACTIVE }, async (q) =>
        (await q('SELECT id FROM memberships')).rows.map((r) => r['id']),
      ),
    ).toEqual([MEMB_1]);
    expect(
      await run(app, { role: 'CUSTOMER', tenant: TENANT_ALPHA, user: USER_ACTIVE }, async (q) =>
        (await q('SELECT id FROM memberships')).rows.map((r) => r['id']),
      ),
    ).toEqual([MEMB_1]);
    expect(
      await blocked(
        app,
        { role: 'CUSTOMER', tenant: TENANT_BETA, user: USER_ACTIVE },
        'SELECT id FROM memberships',
      ),
    ).toBe(true);
  });
  it('app has no write grants on memberships; admin manages them', async () => {
    await expect(
      run(app, { role: 'MERCHANT', user: USER_ACTIVE }, (q) =>
        q("UPDATE memberships SET status='REVOKED' WHERE id=$1", [MEMB_1]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin.query("UPDATE memberships SET status='REVOKED' WHERE id=$1", [MEMB_1]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('IP-4 auth_codes policies (6.4, STM-14)', () => {
  it('GUEST reads, creates and consumes codes only for the login email identity', async () => {
    expect(
      await run(app, { role: 'GUEST', loginEmail: 'user2@example.com' }, async (q) =>
        (await q('SELECT id FROM auth_codes')).rows.map((r) => r['id']),
      ),
    ).toEqual([CODE_1]);
    expect(
      await blocked(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, 'SELECT id FROM auth_codes'),
    ).toBe(true);
    await run(app, { role: 'GUEST', loginEmail: 'user2@example.com' }, async (q) => {
      expect(
        (
          await q(
            "INSERT INTO auth_codes (id, user_id, purpose, code_hash, expires_at) VALUES ($1,$2,'RESET_PASSWORD','c2', now() + interval '10 minutes')",
            [seedId(303), USER_PENDING],
          )
        ).rowCount,
      ).toBe(1);
      expect((await q('UPDATE auth_codes SET attempts=attempts+1 WHERE id=$1', [CODE_1])).rowCount).toBe(1);
    });
  });
  it('a code may never live longer than 10 minutes', async () => {
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'user2@example.com' }, (q) =>
        q(
          "INSERT INTO auth_codes (id, user_id, purpose, code_hash, expires_at) VALUES ($1,$2,'RESET_PASSWORD','c3', now() + interval '11 minutes')",
          [seedId(304), USER_PENDING],
        ),
      ),
    ).rejects.toThrow(/violates check constraint/);
  });
  it('immutable code fields are not updatable by the app (correction B)', async () => {
    for (const sql of [
      "UPDATE auth_codes SET purpose='RESET_PASSWORD' WHERE id=$1",
      "UPDATE auth_codes SET code_hash='x' WHERE id=$1",
      'UPDATE auth_codes SET expires_at=now() WHERE id=$1',
    ]) {
      await expect(
        run(app, { role: 'GUEST', loginEmail: 'user2@example.com' }, (q) => q(sql, [CODE_1])),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('IP-4 sessions policies (6.4, STM-12, STM-13)', () => {
  it('login issues a session only for the login-email identity', async () => {
    await run(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, async (q) => {
      expect(
        (
          await q(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days')",
            [seedId(305), USER_ACTIVE],
          )
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, (q) =>
        q("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2, now() + interval '30 days')", [
          seedId(306),
          USER_OTHER,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it('a session may not outlive the 30 day absolute lifetime', async () => {
    await expect(
      run(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, (q) =>
        q("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2, now() + interval '31 days')", [
          seedId(307),
          USER_ACTIVE,
        ]),
      ),
    ).rejects.toThrow(/violates check constraint/);
  });
  it('correction D: guest lookup is scoped to the authenticating or token-resolved user', async () => {
    expect(await blocked(app, { role: 'GUEST' }, 'SELECT id FROM sessions')).toBe(true);
    expect(
      await run(app, { role: 'GUEST', loginEmail: 'user1@example.com' }, async (q) =>
        (await q('SELECT id FROM sessions')).rows.map((r) => r['id']),
      ),
    ).toEqual([SESSION_1]);
    expect(
      await blocked(app, { role: 'GUEST', loginEmail: 'user3@example.com' }, 'SELECT id FROM sessions'),
    ).toBe(true);
  });
  it('logout/reuse revocation sets revoked_at; identity columns are immutable (correction B)', async () => {
    await run(app, { role: 'GUEST', user: USER_ACTIVE }, async (q) => {
      expect(
        (
          await q("UPDATE sessions SET revoked_at=now(), revoked_reason='LOGOUT' WHERE id=$1", [
            SESSION_1,
          ])
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      run(app, { role: 'GUEST', user: USER_ACTIVE }, (q) =>
        q('UPDATE sessions SET user_id=$1 WHERE id=$2', [USER_OTHER, SESSION_1]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      run(app, { role: 'GUEST', user: USER_ACTIVE }, (q) =>
        q('UPDATE sessions SET expires_at=now() WHERE id=$1', [SESSION_1]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it('owner cleanup removes expired sessions, never fresh ones', async () => {
    const s = superClient();
    await s.connect();
    await s.query(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1,$2, now() - interval '40 days', now() - interval '10 days')",
      [seedId(308), USER_ACTIVE],
    );
    await s.end();
    await expect(
      run(owner, {}, (q) => q('DELETE FROM sessions WHERE id=$1', [seedId(308)])),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      run(owner, {}, (q) => q('DELETE FROM sessions WHERE id=$1', [SESSION_1])),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe('IP-4 refresh_tokens policies (6.4, STM-12, correction A)', () => {
  it('lookup and rotation happen only by exact token hash', async () => {
    expect(
      await run(app, { role: 'GUEST', tokenHash: 'tok1' }, async (q) =>
        (await q('SELECT id FROM refresh_tokens')).rows.map((r) => r['id']),
      ),
    ).toEqual([RT_1]);
    expect(await blocked(app, { role: 'GUEST', tokenHash: 'other' }, 'SELECT id FROM refresh_tokens')).toBe(
      true,
    );
    await expect(
      run(app, { role: 'GUEST', tokenHash: 'tok1' }, (q) =>
        q("UPDATE refresh_tokens SET token_hash='hijacked' WHERE id=$1", [RT_1]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it('rotation: successor first, then replaced_by_id (FK order); wrong order fails', async () => {
    const next = seedId(309);
    await expect(
      run(app, { role: 'GUEST', tokenHash: 'tok1' }, (q) =>
        q('UPDATE refresh_tokens SET replaced_by_id=$1 WHERE id=$2', [next, RT_1]),
      ),
    ).rejects.toThrow(/violates foreign key constraint/);
    await run(app, { role: 'GUEST', tokenHash: 'tok1', user: USER_ACTIVE }, async (q) => {
      expect(
        (
          await q(
            "INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, status, expires_at, session_expires_at) VALUES ($1,$2,$3,'tok2','ACTIVE', now() + interval '7 days', $4)",
            [next, SESSION_1, USER_ACTIVE, session1Expires],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await q("UPDATE refresh_tokens SET status='ROTATED', replaced_by_id=$1 WHERE id=$2", [
            next,
            RT_1,
          ])
        ).rowCount,
      ).toBe(1);
    });
  });
  it('correction A: issue rejects a forged session_expires_at or a foreign session', async () => {
    await expect(
      run(app, { role: 'GUEST', user: USER_ACTIVE }, (q) =>
        q(
          "INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, status, expires_at, session_expires_at) VALUES ($1,$2,$3,'tok3','ACTIVE', now() + interval '7 days', now() + interval '99 days')",
          [seedId(310), SESSION_1, USER_ACTIVE],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      run(app, { role: 'GUEST', user: USER_OTHER }, (q) =>
        q(
          "INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, status, expires_at, session_expires_at) VALUES ($1,$2,$3,'tok4','ACTIVE', now() + interval '7 days', $4)",
          [seedId(311), SESSION_1, USER_OTHER, session1Expires],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it('a revoked session cannot mint new refresh tokens (reuse containment)', async () => {
    const s = superClient();
    await s.connect();
    await s.query(
      "UPDATE sessions SET revoked_at=now(), revoked_reason='REUSE_DETECTED' WHERE id=$1",
      [SESSION_1],
    );
    await s.end();
    await expect(
      run(app, { role: 'GUEST', user: USER_ACTIVE }, (q) =>
        q(
          "INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, status, expires_at, session_expires_at) VALUES ($1,$2,$3,'tok5','ACTIVE', now() + interval '7 days', $4)",
          [seedId(312), SESSION_1, USER_ACTIVE, session1Expires],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('IP-4 audit_log policies (6.4, D4)', () => {
  it('app writes audit rows for its own tenant context only', async () => {
    await run(app, { role: 'MERCHANT', tenant: TENANT_ALPHA, user: USER_ACTIVE }, async (q) => {
      expect(
        (
          await q(
            "INSERT INTO audit_log (id, actor_user_id, actor_role, action, tenant_id, outcome) VALUES ($1,$2,'MERCHANT','PRODUCT_UPDATE',$3,'ALLOWED')",
            [seedId(313), USER_ACTIVE, TENANT_ALPHA],
          )
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      run(app, { role: 'MERCHANT', tenant: TENANT_ALPHA, user: USER_ACTIVE }, (q) =>
        q(
          "INSERT INTO audit_log (id, actor_user_id, actor_role, action, tenant_id, outcome) VALUES ($1,$2,'MERCHANT','PRODUCT_UPDATE',$3,'ALLOWED')",
          [seedId(314), USER_ACTIVE, TENANT_BETA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it('app cannot read audit history; admin reads it; owner prunes only rows older than 90 days', async () => {
    await expect(app.query('SELECT id FROM audit_log')).rejects.toThrow(/permission denied/);
    const s = superClient();
    await s.connect();
    await s.query(
      "INSERT INTO audit_log (id, occurred_at, action, outcome) VALUES ($1, now() - interval '100 days', 'OLD', 'ALLOWED'),($2, now(), 'NEW', 'ALLOWED')",
      [seedId(315), seedId(316)],
    );
    await s.end();
    expect((await admin.query('SELECT id FROM audit_log')).rowCount).toBe(2);
    await expect(
      run(owner, {}, (q) => q('DELETE FROM audit_log WHERE id=$1', [seedId(315)])),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      run(owner, {}, (q) => q('DELETE FROM audit_log WHERE id=$1', [seedId(316)])),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});
