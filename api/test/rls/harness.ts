import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool, PoolConfig } from 'pg';

/**
 * RLS harness: real PostgreSQL, RLS on, connecting as multistore_app / multistore_admin
 * (never as a superuser). Setup connects as the maintenance superuser only to create roles.
 * Environment: PGHOST, PGPORT, PGUSER (superuser), PGPASSWORD (optional), PGDATABASE.
 */
export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';
export const USER_1 = '33333333-3333-4333-8333-333333333333';
export const USER_2 = '44444444-4444-4444-8444-444444444444';
const ROLE_PW = 'rls-harness-test-only';

const base = (): PoolConfig => ({
  host: process.env['PGHOST'] ?? '/tmp/pgdata',
  port: Number(process.env['PGPORT'] ?? 5432),
  database: process.env['PGDATABASE'] ?? 'postgres',
});

export function superClient(): Client {
  const b = base();
  return new Client({
    ...b,
    user: process.env['PGUSER'] ?? 'postgres',
    password: process.env['PGPASSWORD'],
  });
}

export function poolAs(
  role: 'multistore_app' | 'multistore_admin' | 'multistore_owner',
  max = 1,
): Pool {
  return new Pool({ ...base(), user: role, password: ROLE_PW, max });
}

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export async function setupDatabase(): Promise<void> {
  const c = superClient();
  await c.connect();
  try {
    await c.query('DROP OWNED BY multistore_owner CASCADE').catch(() => undefined);
    for (const r of ['multistore_owner', 'multistore_app', 'multistore_admin']) {
      const exists = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r]);
      if (exists.rowCount === 0) {
        const extra = r === 'multistore_admin' ? 'NOINHERIT CONNECTION LIMIT 3' : '';
        await c.query(
          `CREATE ROLE ${r} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION ${extra} PASSWORD '${ROLE_PW}'`,
        );
      }
    }
    await c.query('GRANT CREATE, USAGE ON SCHEMA public TO multistore_owner');
  } finally {
    await c.end();
  }
  // The IP-3 products/favorites fixture (fixtures/001_products.sql) is retired: the real
  // IP-5 migration creates the products table used by RLS tests (Batch 1 authorization
  // section 6). Each spec applies the migrations it needs and seeds its own data as the
  // superuser, because FORCE RLS binds the owner. Favorites remain deferred to IP-6.
}

export interface Ctx {
  role?: string;
  tenant?: string;
  user?: string;
  tenantCode?: string;
  loginEmail?: string;
  tokenHash?: string;
}

/** The transaction runner shape from spec 6.3: context set locally, in the same transaction as the query. */
export async function run<T>(
  pool: Pool,
  ctx: Ctx,
  fn: (
    q: (
      sql: string,
      p?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>,
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ctx.role !== undefined)
      await client.query("SELECT set_config('app.role', $1, true)", [ctx.role]);
    if (ctx.tenant !== undefined)
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenant]);
    if (ctx.user !== undefined)
      await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.user]);
    if (ctx.tenantCode !== undefined)
      await client.query("SELECT set_config('app.tenant_code', $1, true)", [ctx.tenantCode]);
    if (ctx.loginEmail !== undefined)
      await client.query("SELECT set_config('app.login_email', $1, true)", [ctx.loginEmail]);
    if (ctx.tokenHash !== undefined)
      await client.query("SELECT set_config('app.token_hash', $1, true)", [ctx.tokenHash]);
    const out = await fn((sql, p) => client.query(sql, p) as never);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export { id as seedId };

/** Applies a SQL migration from prisma/migrations as multistore_owner, as the deploy step does. */
export async function applyMigration(dir: string): Promise<void> {
  const owner = poolAs('multistore_owner');
  try {
    await owner.query(
      readFileSync(
        join(__dirname, '..', '..', 'prisma', 'migrations', dir, 'migration.sql'),
        'utf8',
      ),
    );
  } finally {
    await owner.end();
  }
}

/** Connection string for Prisma as multistore_app over the local socket. */
export function appDatabaseUrl(): string {
  const host = process.env['PGHOST'] ?? '/tmp/pgdata';
  return `postgresql://multistore_app:${ROLE_PW}@localhost:${process.env['PGPORT'] ?? 5432}/${process.env['PGDATABASE'] ?? 'postgres'}?host=${encodeURIComponent(host)}&connection_limit=1`;
}
