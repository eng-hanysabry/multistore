import { Pool } from 'pg';
import {
  Ctx,
  TENANT_A,
  TENANT_B,
  USER_1,
  USER_2,
  applyMigration,
  poolAs,
  run,
  seedId,
  setupDatabase,
  superClient,
} from './harness';

/**
 * Spec 6.4 policy matrix against the REAL IP-4 + IP-5 migrations (Batch 1 authorization
 * section 6): the old IP-3 fixture products/favorites tables are retired; the products
 * table here is created by the IP-5 migration. Favorites coverage is deferred to IP-6.
 * Seeds run as the superuser because FORCE RLS binds the owner. Published products are
 * seeded through the real lifecycle (DRAFT insert, ACTIVE image, then publish) so the
 * products_publish_guard trigger sees valid state.
 */

const MEDIA_PUB_A = seedId(50);
const MEDIA_PUB_B = seedId(51);

const ALL_TENANT_TABLES = [
  'audit_log',
  'auth_codes',
  'categories',
  'idempotency_keys',
  'media_assets',
  'memberships',
  'products',
  'refresh_tokens',
  'sessions',
  'tenants',
  'users',
];

let app: Pool;
let admin: Pool;
let appOne: Pool; // pool of ONE connection: the pooler reuse case
let owner: Pool;

const names = async (pool: Pool, ctx: Ctx, tenant: string): Promise<string[]> =>
  run(pool, ctx, async (q) =>
    (await q('SELECT name FROM products WHERE tenant_id = $1 ORDER BY name', [tenant])).rows.map(
      (r) => r['name'] as string,
    ),
  );
const denied = async (pool: Pool, ctx: Ctx, sql: string, p: unknown[]): Promise<boolean> => {
  try {
    return (await run(pool, ctx, async (q) => (await q(sql, p)).rowCount)) === 0;
  } catch {
    return true;
  }
};
const INS =
  "INSERT INTO products (id, tenant_id, name, status, created_by) VALUES ('99999999-9999-4999-8999-999999999999', $1, 'x', 'DRAFT', '" +
  USER_1 +
  "')";
const UPD = "UPDATE products SET name = 'z' WHERE tenant_id = $1";
const DEL = 'DELETE FROM products WHERE tenant_id = $1';
const fails = async (pool: Pool, sql: string): Promise<boolean> => {
  try {
    await pool.query(sql);
    return false;
  } catch {
    return true;
  }
};

async function seed(): Promise<void> {
  // Seed as the superuser: the owner is itself subject to FORCE RLS. The publish guard
  // trigger runs for the superuser too, so published products are seeded through the
  // real lifecycle: DRAFT insert, ACTIVE PRODUCT_IMAGE, then publish.
  const s = superClient();
  await s.connect();
  try {
    await s.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'m1@example.com','h','ACTIVE'),($2,'m2@example.com','h','ACTIVE')",
      [USER_1, USER_2],
    );
    let n = 1;
    for (const [t, code] of [
      [TENANT_A, 'tenant-a'],
      [TENANT_B, 'tenant-b'],
    ] as const) {
      await s.query('INSERT INTO tenants (id, code, name, status) VALUES ($1,$2,$3,$4)', [
        t,
        code,
        code,
        'ACTIVE',
      ]);
      const pub = seedId(n++);
      const draft = seedId(n++);
      await s.query(
        "INSERT INTO products (id, tenant_id, name, status, created_by) VALUES ($1,$2,'pub','DRAFT',$3),($4,$2,'draft','DRAFT',$3)",
        [pub, t, USER_1, draft],
      );
      await s.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [t === TENANT_A ? MEDIA_PUB_A : MEDIA_PUB_B, t, pub, USER_1],
      );
      await s.query(
        "UPDATE products SET status = 'PUBLISHED', published_at = now() WHERE id = $1",
        [pub],
      );
    }
  } finally {
    await s.end();
  }
}

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261126160002_ip4_identity_tenancy');
  await applyMigration('20261127221500_ip5_catalog_and_media');
  await seed();
  app = poolAs('multistore_app', 4);
  admin = poolAs('multistore_admin', 1);
  appOne = poolAs('multistore_app', 1);
  owner = poolAs('multistore_owner', 1);
});
afterAll(async () => {
  await Promise.all([app.end(), admin.end(), appOne.end(), owner.end()]);
});

describe('role attributes (6.4, 6.6)', () => {
  it('rolsuper=false and rolbypassrls=false for all three roles', async () => {
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'multistore_%' ORDER BY 1",
    );
    await c.end();
    expect(r.rows).toEqual([
      { rolname: 'multistore_admin', rolsuper: false, rolbypassrls: false },
      { rolname: 'multistore_app', rolsuper: false, rolbypassrls: false },
      { rolname: 'multistore_owner', rolsuper: false, rolbypassrls: false },
    ]);
  });
  it('the runtime connection logs in as multistore_app', async () => {
    expect((await app.query('SELECT current_user AS u')).rows[0]).toEqual({ u: 'multistore_app' });
  });
  it('RLS is enabled and forced on every tenant table', async () => {
    const r = await app.query(
      `SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity ORDER BY 1`,
      [ALL_TENANT_TABLES],
    );
    expect(r.rows.map((x) => x['relname'])).toEqual(ALL_TENANT_TABLES);
  });
});

describe('policy matrix on products (6.4)', () => {
  for (const role of ['GUEST', 'CUSTOMER']) {
    it(`${role}: published only in own tenant, nothing in other, no writes`, async () => {
      const ctx = { role, tenant: TENANT_A, user: USER_1 };
      expect(await names(app, ctx, TENANT_A)).toEqual(['pub']);
      expect(await names(app, ctx, TENANT_B)).toEqual([]);
      for (const sql of [INS, UPD, DEL]) {
        expect(await denied(app, ctx, sql, [TENANT_A])).toBe(true);
        expect(await denied(app, ctx, sql, [TENANT_B])).toBe(true);
      }
    });
  }
  it('MERCHANT: all rows of own tenant, nothing of the other, writes only in own tenant', async () => {
    const ctx = { role: 'MERCHANT', tenant: TENANT_A };
    expect(await names(app, ctx, TENANT_A)).toEqual(['draft', 'pub']);
    expect(await names(app, ctx, TENANT_B)).toEqual([]);
    for (const sql of [INS, UPD, DEL]) expect(await denied(app, ctx, sql, [TENANT_B])).toBe(true);
    // allowed in own tenant (the inserted row is DRAFT, so the delete policy allows it)
    await run(app, ctx, async (q) => {
      expect((await q(INS, [TENANT_A])).rowCount).toBe(1);
      expect(
        (await q("UPDATE products SET name = 'z' WHERE tenant_id = $1 AND name = 'x'", [TENANT_A]))
          .rowCount,
      ).toBe(1);
      expect(
        (await q("DELETE FROM products WHERE tenant_id = $1 AND name = 'z'", [TENANT_A])).rowCount,
      ).toBe(1);
    });
  });
  it('a Merchant cannot insert a row already PUBLISHED (status is lifecycle-controlled)', async () => {
    const ctx = { role: 'MERCHANT', tenant: TENANT_A };
    await expect(
      run(app, ctx, (q) =>
        q(
          "INSERT INTO products (id, tenant_id, name, status, published_at, created_by) VALUES ('99999999-9999-4999-8999-999999999998', $1, 'y', 'PUBLISHED', now(), $2)",
          [TENANT_A, USER_1],
        ),
      ),
    ).rejects.toThrow();
  });
  it('WITH CHECK blocks a Merchant moving a row to another tenant', async () => {
    const ctx = { role: 'MERCHANT', tenant: TENANT_A };
    await expect(
      run(app, ctx, (q) =>
        q('UPDATE products SET tenant_id = $1 WHERE tenant_id = $2', [TENANT_B, TENANT_A]),
      ),
    ).rejects.toThrow();
  });
  it('SUPER ADMIN (multistore_admin): reads all tenants, writes nothing (read-only role)', async () => {
    expect(await names(admin, {}, TENANT_A)).toEqual(['draft', 'pub']);
    expect(await names(admin, {}, TENANT_B)).toEqual(['draft', 'pub']);
    await run(admin, {}, async (q) => {
      await expect(q(INS, [TENANT_B])).rejects.toThrow();
      await expect(q(DEL, [TENANT_B])).rejects.toThrow();
      await expect(q(UPD, [TENANT_B])).rejects.toThrow();
    });
  });
  it('unknown, empty and non-matching roles see zero rows', async () => {
    for (const role of ['', 'SUPER_ADMIN', 'merchant', 'GUEST '])
      expect(await names(app, { role, tenant: TENANT_A }, TENANT_A)).toEqual([]);
  });
  it('removing the admin select policy leaves multistore_admin with zero rows', async () => {
    await owner.query('ALTER POLICY products_admin_select ON products USING (false)');
    try {
      expect(await names(admin, {}, TENANT_A)).toEqual([]);
    } finally {
      await owner.query('ALTER POLICY products_admin_select ON products USING (true)');
    }
  });
});

describe('missing or invalid context fails closed', () => {
  it('no context: zero rows, writes denied (fresh and reused connection)', async () => {
    for (const pool of [app, appOne]) {
      expect(await names(pool, {}, TENANT_A)).toEqual([]);
      for (const sql of [INS, UPD, DEL]) expect(await denied(pool, {}, sql, [TENANT_A])).toBe(true);
    }
  });
  it('role without tenant, and tenant without role: zero rows', async () => {
    expect(await names(app, { role: 'MERCHANT' }, TENANT_A)).toEqual([]);
    expect(await names(app, { tenant: TENANT_A }, TENANT_A)).toEqual([]);
  });
  it('reused pooled connection that earlier set context returns zero rows, not an error (v4.9 NULLIF)', async () => {
    await run(appOne, { role: 'MERCHANT', tenant: TENANT_A }, (q) => q('SELECT 1'));
    expect(await names(appOne, {}, TENANT_A)).toEqual([]);
    const probe = await run(
      appOne,
      {},
      async (q) => (await q("SELECT current_setting('app.tenant_id', true) AS t")).rows[0],
    );
    expect(['', null]).toContain(probe?.['t']);
  });
  it('a non-UUID tenant value fails closed (error, never data)', async () => {
    await expect(
      names(app, { role: 'MERCHANT', tenant: 'not-a-uuid' }, TENANT_A),
    ).rejects.toThrow();
  });
});

describe('transaction-local context, pool of one (6.4)', () => {
  it('alternating tenants on ONE connection never see each other, 40 rounds', async () => {
    for (let i = 0; i < 40; i++) {
      const t = i % 2 === 0 ? TENANT_A : TENANT_B;
      const rows = await run(
        appOne,
        { role: 'MERCHANT', tenant: t },
        async (q) => (await q('SELECT DISTINCT tenant_id FROM products')).rows,
      );
      expect(rows).toEqual([{ tenant_id: t }]);
    }
  });
  it('concurrent requests queued on one connection do not mix tenants', async () => {
    const jobs = Array.from({ length: 30 }, (_, i) => {
      const t = i % 2 === 0 ? TENANT_A : TENANT_B;
      return run(
        appOne,
        { role: 'MERCHANT', tenant: t },
        async (q) => (await q('SELECT DISTINCT tenant_id FROM products')).rows,
      ).then((r) => ({ t, r }));
    });
    for (const { t, r } of await Promise.all(jobs)) expect(r).toEqual([{ tenant_id: t }]);
  });
  it('context is gone after commit, after rollback, and after a request that throws midway', async () => {
    await run(appOne, { role: 'MERCHANT', tenant: TENANT_A }, (q) => q('SELECT 1'));
    const afterCommit = await run(
      appOne,
      {},
      async (q) => (await q("SELECT current_setting('app.role', true) AS r")).rows[0],
    );
    expect(['', null]).toContain(afterCommit?.['r']);
    await expect(
      run(appOne, { role: 'MERCHANT', tenant: TENANT_A }, (q) => q('SELECT 1/0')),
    ).rejects.toThrow();
    expect(await names(appOne, {}, TENANT_A)).toEqual([]);
  });
  it('contrast: a session-level setting WOULD leak, which is why the lint bans it', async () => {
    const c = await appOne.connect();
    try {
      await c.query("SELECT set_config('app.role', 'MERCHANT', false)");
      await c.query(`SELECT set_config('app.tenant_id', '${TENANT_A}', false)`);
      expect((await c.query('SELECT 1 FROM products')).rowCount).toBeGreaterThan(0);
      await c.query("SELECT set_config('app.role', '', false)");
      await c.query("SELECT set_config('app.tenant_id', '', false)");
    } finally {
      c.release();
    }
  });
});

describe('grants and privilege separation (6.4, 6.6)', () => {
  it('multistore_app cannot SET ROLE / SET SESSION AUTHORIZATION / DDL / TRUNCATE / disable RLS', async () => {
    for (const sql of [
      'SET ROLE multistore_admin',
      'SET ROLE multistore_owner',
      'SET SESSION AUTHORIZATION postgres',
      'CREATE TABLE public.t (i int)',
      'TRUNCATE products',
      'ALTER TABLE products DISABLE ROW LEVEL SECURITY',
    ]) {
      expect(await fails(app, sql)).toBe(true);
    }
  });
  it('multistore_admin cannot disable RLS, drop policies/tables, take ownership, join owner, SET ROLE, create objects', async () => {
    for (const sql of [
      'ALTER TABLE products DISABLE ROW LEVEL SECURITY',
      'ALTER TABLE products NO FORCE ROW LEVEL SECURITY',
      'DROP POLICY products_admin_select ON products',
      'DROP TABLE products',
      'ALTER TABLE products OWNER TO multistore_admin',
      'GRANT multistore_owner TO multistore_admin',
      'SET ROLE multistore_owner',
      'SET ROLE multistore_app',
      'CREATE TABLE public.t (i int)',
    ]) {
      expect(await fails(admin, sql)).toBe(true);
    }
  });
  it('multistore_admin owns zero objects; PUBLIC has no privileges on application tables', async () => {
    const c = superClient();
    await c.connect();
    const owns = await c.query(
      "SELECT count(*)::int AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'multistore_admin'",
    );
    const pub = await c.query(
      "SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = 'PUBLIC' AND table_name = ANY($1)",
      [ALL_TENANT_TABLES],
    );
    await c.end();
    expect(owns.rows[0]?.['n']).toBe(0);
    expect(pub.rows[0]?.['n']).toBe(0);
  });
  it('multistore_app has exactly the approved DML grants (grants snapshot)', async () => {
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'multistore_app' ORDER BY 1, 2",
    );
    await c.end();
    const dml = (t: string): { table_name: string; privilege_type: string }[] =>
      ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((p) => ({ table_name: t, privilege_type: p }));
    // Table-level view: column-level UPDATE grants (IP-4 correction B) do not appear
    // here; they are asserted separately against column_privileges below.
    const expected = [
      { table_name: 'audit_log', privilege_type: 'INSERT' },
      ...['INSERT', 'SELECT'].map((p) => ({ table_name: 'auth_codes', privilege_type: p })),
      ...dml('categories'),
      ...['INSERT', 'SELECT'].map((p) => ({
        table_name: 'idempotency_keys',
        privilege_type: p,
      })),
      ...dml('media_assets'),
      { table_name: 'memberships', privilege_type: 'SELECT' },
      ...dml('products'),
      ...['INSERT', 'SELECT'].map((p) => ({
        table_name: 'refresh_tokens',
        privilege_type: p,
      })),
      ...['INSERT', 'SELECT'].map((p) => ({ table_name: 'sessions', privilege_type: p })),
      { table_name: 'tenants', privilege_type: 'SELECT' },
      ...['INSERT', 'SELECT'].map((p) => ({ table_name: 'users', privilege_type: p })),
    ];
    expect(r.rows).toEqual(expected);
  });
  it('multistore_app column-level UPDATE grants are exactly the approved IP-4 set', async () => {
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT table_name, column_name FROM information_schema.column_privileges WHERE grantee = 'multistore_app' AND privilege_type = 'UPDATE' AND table_name IN ('auth_codes','sessions','refresh_tokens','users') ORDER BY 1, 2",
    );
    await c.end();
    expect(r.rows).toEqual([
      { table_name: 'auth_codes', column_name: 'attempts' },
      { table_name: 'auth_codes', column_name: 'consumed_at' },
      { table_name: 'refresh_tokens', column_name: 'replaced_by_id' },
      { table_name: 'refresh_tokens', column_name: 'status' },
      { table_name: 'sessions', column_name: 'revoked_at' },
      { table_name: 'sessions', column_name: 'revoked_reason' },
      { table_name: 'users', column_name: 'email_verified_at' },
      { table_name: 'users', column_name: 'password_changed_at' },
      { table_name: 'users', column_name: 'password_hash' },
      { table_name: 'users', column_name: 'status' },
      { table_name: 'users', column_name: 'updated_at' },
    ]);
  });
  it('multistore_admin has read-only grants on catalog/media and none on idempotency_keys', async () => {
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'multistore_admin' AND table_name = ANY($1) ORDER BY 1, 2",
      [['categories', 'products', 'media_assets', 'idempotency_keys']],
    );
    await c.end();
    expect(r.rows).toEqual([
      { table_name: 'categories', privilege_type: 'SELECT' },
      { table_name: 'media_assets', privilege_type: 'SELECT' },
      { table_name: 'products', privilege_type: 'SELECT' },
    ]);
  });
  it('a newly created table is not readable by multistore_app until a migration grants it', async () => {
    await owner.query('CREATE TABLE IF NOT EXISTS newt (id uuid PRIMARY KEY)');
    try {
      expect(await fails(app, 'SELECT * FROM newt')).toBe(true);
    } finally {
      await owner.query('DROP TABLE newt');
    }
  });
  it('seed ids are valid uuids with no database default on any id column', async () => {
    expect(seedId(1)).toMatch(/^[0-9a-f-]{36}$/);
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = ANY($1) AND column_name = 'id' AND column_default IS NOT NULL",
      [ALL_TENANT_TABLES],
    );
    await c.end();
    expect(r.rows[0]?.['n']).toBe(0);
  });
});
