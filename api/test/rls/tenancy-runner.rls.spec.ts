import { PrismaClient } from '@prisma/client';
import { PrismaTenantTransactionRunner } from '../../src/modules/tenancy/infrastructure/prisma-tenant-transaction-runner';
import { TenantContext } from '../../src/modules/tenancy/domain/tenant-context';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * TenantTransactionRunner on real PostgreSQL as multistore_app (spec 6.3): context is set
 * inside the transaction only, queries see exactly that context, and nothing leaks into the
 * next transaction on the same pooled connection (pool of ONE).
 */

let db: PrismaClient; // pool of ONE connection
let runner: PrismaTenantTransactionRunner;

const TENANT_ALPHA = seedId(201);

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  const s = superClient();
  await s.connect();
  await s.query(
    "INSERT INTO tenants (id, code, name, status) VALUES ($1,'alpha-shop','Alpha','ACTIVE')",
    [TENANT_ALPHA],
  );
  await s.end();
  db = new PrismaClient({ datasourceUrl: appDatabaseUrl() });
  runner = new PrismaTenantTransactionRunner(db);
});
afterAll(async () => {
  await db.$disconnect();
});

const tenantCodes = (tx: unknown): Promise<string> =>
  (tx as PrismaClient).$queryRaw<{ code: string }[]>`SELECT code FROM tenants`.then((rows) =>
    rows.map((r) => r.code).join(','),
  );

describe('TenantTransactionRunner (6.3)', () => {
  it('context and queries share one transaction: the role/tenant context applies', async () => {
    const ctx: TenantContext = { role: 'GUEST', tenantCode: 'alpha-shop' };
    await expect(runner.run(ctx, tenantCodes)).resolves.toBe('alpha-shop');
    await expect(runner.run({ role: 'GUEST', tenantCode: 'no-such' }, tenantCodes)).resolves.toBe(
      '',
    );
    await expect(runner.run({ role: 'GUEST' }, tenantCodes)).resolves.toBe('');
  });

  it('context never leaks into the next transaction on the same pooled connection', async () => {
    await runner.run({ role: 'MERCHANT', tenantId: TENANT_ALPHA }, tenantCodes);
    // Same connection, new transaction, no context: zero rows, not an error and not stale data.
    await expect(
      runner.run({ role: 'MERCHANT', tenantId: seedId(202) }, tenantCodes),
    ).resolves.toBe('');
    await expect(runner.run({ role: 'GUEST' }, tenantCodes)).resolves.toBe('');
  });

  it('a failing work function rolls the transaction back (context and writes gone)', async () => {
    await expect(
      runner.run({ role: 'GUEST', tenantCode: 'alpha-shop' }, async (tx) => {
        await (tx as PrismaClient)
          .$executeRaw`SELECT set_config('app.tenant_code', 'beta-shop', true)`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(runner.run({ role: 'GUEST' }, tenantCodes)).resolves.toBe('');
  });

  it('an invalid context is rejected before any query runs', async () => {
    const spy = jest.spyOn(db, '$transaction');
    await expect(runner.run({ role: 'NOPE' } as never, tenantCodes)).rejects.toThrow(
      'invalid tenant context',
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
