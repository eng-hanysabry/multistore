import { Pool } from 'pg';
import {
  Ctx,
  TENANT_A,
  TENANT_B,
  USER_1,
  USER_2,
  poolAs,
  run,
  seedId,
  setupDatabase,
  superClient,
} from './harness';

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
  "INSERT INTO products (id, tenant_id, name, status) VALUES ('99999999-9999-4999-8999-999999999999', $1, 'x', 'PUBLISHED')";
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

beforeAll(async () => {
  await setupDatabase();
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
      "SELECT relname FROM pg_class WHERE relname IN ('products','favorites') AND relrowsecurity AND relforcerowsecurity ORDER BY 1",
    );
    expect(r.rows.map((x) => x['relname'])).toEqual(['favorites', 'products']);
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
    // allowed in own tenant (rolled back by a failing statement at the end so seed data stays)
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
  it('WITH CHECK blocks a Merchant moving a row to another tenant', async () => {
    const ctx = { role: 'MERCHANT', tenant: TENANT_A };
    await expect(
      run(app, ctx, (q) =>
        q('UPDATE products SET tenant_id = $1 WHERE tenant_id = $2', [TENANT_B, TENANT_A]),
      ),
    ).rejects.toThrow();
  });
  it('SUPER ADMIN (multistore_admin): all tenants, all operations', async () => {
    expect(await names(admin, {}, TENANT_A)).toEqual(['draft', 'pub']);
    expect(await names(admin, {}, TENANT_B)).toEqual(['draft', 'pub']);
    await run(admin, {}, async (q) => {
      expect((await q(INS, [TENANT_B])).rowCount).toBe(1);
      expect(
        (await q("DELETE FROM products WHERE tenant_id = $1 AND name = 'x'", [TENANT_B])).rowCount,
      ).toBe(1);
    });
  });
  it('unknown, empty and non-matching roles see zero rows', async () => {
    for (const role of ['', 'SUPER_ADMIN', 'merchant', 'GUEST '])
      expect(await names(app, { role, tenant: TENANT_A }, TENANT_A)).toEqual([]);
  });
  it('removing admin_all leaves multistore_admin with zero rows', async () => {
    await owner.query('ALTER POLICY admin_all ON products USING (false)');
    try {
      expect(await names(admin, {}, TENANT_A)).toEqual([]);
    } finally {
      await owner.query('ALTER POLICY admin_all ON products USING (true)');
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
  it('Customer without app.user_id sees zero personal rows', async () => {
    const r = await run(
      app,
      { role: 'CUSTOMER', tenant: TENANT_A },
      async (q) => (await q('SELECT id FROM favorites')).rows,
    );
    expect(r).toEqual([]);
  });
  it('Customer sees only own personal rows in the active tenant', async () => {
    const mine = await run(
      app,
      { role: 'CUSTOMER', tenant: TENANT_A, user: USER_1 },
      async (q) => (await q('SELECT user_id FROM favorites')).rows,
    );
    expect(mine).toEqual([{ user_id: USER_1 }]);
    const other = await run(
      app,
      { role: 'CUSTOMER', tenant: TENANT_A, user: USER_2 },
      async (q) => (await q('SELECT user_id FROM favorites')).rows,
    );
    expect(other).toEqual([{ user_id: USER_2 }]);
    const wrongTenant = await run(
      app,
      { role: 'CUSTOMER', tenant: TENANT_B, user: USER_1 },
      async (q) => (await q('SELECT 1 FROM favorites')).rows,
    );
    expect(wrongTenant).toEqual([]);
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
      'DROP POLICY admin_all ON products',
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
      "SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = 'PUBLIC' AND table_name IN ('products','favorites')",
    );
    await c.end();
    expect(owns.rows[0]?.['n']).toBe(0);
    expect(pub.rows[0]?.['n']).toBe(0);
  });
  it('multistore_app has only DML on the tables it needs (grants snapshot)', async () => {
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'multistore_app' ORDER BY 1, 2",
    );
    await c.end();
    const expected = ['favorites', 'products'].flatMap((t) =>
      ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((p) => ({ table_name: t, privilege_type: p })),
    );
    expect(r.rows).toEqual(expected);
  });
  it('a newly created table is not readable by multistore_app until a migration grants it', async () => {
    await owner.query('CREATE TABLE IF NOT EXISTS newt (id uuid PRIMARY KEY)');
    try {
      expect(await fails(app, 'SELECT * FROM newt')).toBe(true);
    } finally {
      await owner.query('DROP TABLE newt');
    }
  });
  it('seed ids are valid uuids with no database default on id', async () => {
    expect(seedId(1)).toMatch(/^[0-9a-f-]{36}$/);
    const c = superClient();
    await c.connect();
    const r = await c.query(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name IN ('products','favorites') AND column_name = 'id' AND column_default IS NOT NULL",
    );
    await c.end();
    expect(r.rows[0]?.['n']).toBe(0);
  });
});
