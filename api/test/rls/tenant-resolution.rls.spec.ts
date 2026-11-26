import { PrismaTenantResolver } from '../../src/infrastructure/prisma/prisma-tenant-resolver';
import { PrismaMembershipChecker } from '../../src/infrastructure/prisma/prisma-membership-checker';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaTenantTransactionRunner } from '../../src/infrastructure/prisma/tenant-transaction-runner';
import {
  applyMigration,
  appDatabaseUrl,
  setupDatabase,
  superClient,
  TENANT_A,
  TENANT_B,
  USER_1,
  USER_2,
} from './harness';

/**
 * Tenant resolution and merchant membership on real PostgreSQL + RLS (spec 6.3, 6.7).
 * Seeds (superuser, because FORCE RLS binds the owner):
 * - TENANT_A code demo-store (ACTIVE), TENANT_B code beta-store (ACTIVE), one SUSPENDED.
 * - USER_1 ACTIVE merchant of TENANT_A; USER_2 REVOKED on TENANT_A, ACTIVE on TENANT_B.
 */

const SUSPENDED = '55555555-5555-4555-8555-555555555555';

let db: PrismaService;

const su = async <T>(fn: (c: ReturnType<typeof superClient>) => Promise<T>): Promise<T> => {
  const c = superClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  db = new PrismaService({ datasourceUrl: appDatabaseUrl() });
  await su(async (c) => {
    await c.query(
      'TRUNCATE tenants, users, memberships, auth_codes, sessions, refresh_tokens, audit_log CASCADE',
    );
    await c.query(
      `INSERT INTO tenants (id, code, name, status) VALUES
        ($1, 'demo-store', 'Demo', 'ACTIVE'),
        ($2, 'beta-store', 'Beta', 'ACTIVE'),
        ($3, 'old-store', 'Old', 'SUSPENDED')`,
      [TENANT_A, TENANT_B, SUSPENDED],
    );
    await c.query(
      `INSERT INTO users (id, email, password_hash, status) VALUES
        ($1, 'm@example.com', 'x', 'ACTIVE'),
        ($2, 'n@example.com', 'x', 'ACTIVE')`,
      [USER_1, USER_2],
    );
    await c.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES
        ('66666666-6666-4666-8666-666666666661', $1, $3, 'MERCHANT', 'ACTIVE'),
        ('66666666-6666-4666-8666-666666666662', $1, $4, 'MERCHANT', 'REVOKED'),
        ('66666666-6666-4666-8666-666666666663', $2, $4, 'MERCHANT', 'ACTIVE')`,
      [TENANT_A, TENANT_B, USER_1, USER_2],
    );
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe('PrismaTenantResolver through the tenant_resolve policy (6.7)', () => {
  it('resolves an ACTIVE code to the tenant UUID', async () => {
    await expect(new PrismaTenantResolver(db).resolve('demo-store')).resolves.toEqual({
      tenantId: TENANT_A,
      tenantCode: 'demo-store',
    });
  });

  it('unknown and suspended codes both resolve to null (policy matches ACTIVE only)', async () => {
    const r = new PrismaTenantResolver(db);
    await expect(r.resolve('no-such-store')).resolves.toBeNull();
    await expect(r.resolve('old-store')).resolves.toBeNull();
  });

  it('caches for the documented 60-second window; a fresh lookup sees a suspension', async () => {
    const r = new PrismaTenantResolver(db);
    await expect(r.resolve('beta-store')).resolves.not.toBeNull();
    await su((c) => c.query("UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1", [TENANT_B]));
    try {
      // within the cache window the resolved value is still served (6.7 accepts this)
      await expect(r.resolve('beta-store')).resolves.not.toBeNull();
      // a resolver without the cached entry sees the suspension at once
      await expect(new PrismaTenantResolver(db).resolve('beta-store')).resolves.toBeNull();
    } finally {
      await su((c) => c.query("UPDATE tenants SET status = 'ACTIVE' WHERE id = $1", [TENANT_B]));
    }
  });
});

describe('PrismaMembershipChecker through the membership_self policy (6.3 rule 2, 6.7)', () => {
  it('finds an ACTIVE membership and misses other tenants and REVOKED rows', async () => {
    const checker = new PrismaMembershipChecker(db);
    await expect(checker.membershipRole(USER_1, TENANT_A)).resolves.toBe('MERCHANT');
    await expect(checker.membershipRole(USER_1, TENANT_B)).resolves.toBeNull();
    await expect(checker.membershipRole(USER_2, TENANT_A)).resolves.toBeNull();
    await expect(checker.membershipRole(USER_2, TENANT_B)).resolves.toBe('MERCHANT');
  });

  it('a MERCHANT context sees only its own membership rows (RLS)', async () => {
    // USER_1's context reading the whole table: USER_2's TENANT_B row is invisible.
    const runner = new PrismaTenantTransactionRunner(db);
    const rows = await runner.run({ role: 'MERCHANT', userId: USER_1 }, async (tx) => {
      return (tx as PrismaService).$queryRaw<
        { user_id: string }[]
      >`SELECT user_id::text AS user_id FROM memberships`;
    });
    expect(rows.map((r: { user_id: string }) => r.user_id)).toEqual([USER_1]);
  });
});
