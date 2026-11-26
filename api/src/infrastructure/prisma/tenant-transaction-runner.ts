import { PrismaClient } from '@prisma/client';
import { assertTenantContext, TenantContext } from '../../common/tenancy/tenant-context';
import { TenantTransactionRunner, TxHandle } from '../../common/tenancy/tenant-transaction-runner';

export class PrismaTenantTransactionRunner implements TenantTransactionRunner {
  constructor(private readonly db: PrismaClient) {}

  async run<T>(ctx: TenantContext, work: (tx: TxHandle) => Promise<T>): Promise<T> {
    const c = assertTenantContext(ctx);
    return this.db.$transaction(async (tx) => {
      // set_config(..., true): transaction-local only. Never session-level (spec 6.3).
      await tx.$executeRaw`SELECT set_config('app.role', ${c.role}, true)`;
      if (c.tenantId !== undefined)
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${c.tenantId}, true)`;
      if (c.userId !== undefined)
        await tx.$executeRaw`SELECT set_config('app.user_id', ${c.userId}, true)`;
      if (c.tenantCode !== undefined)
        await tx.$executeRaw`SELECT set_config('app.tenant_code', ${c.tenantCode}, true)`;
      if (c.loginEmail !== undefined)
        await tx.$executeRaw`SELECT set_config('app.login_email', ${c.loginEmail}, true)`;
      if (c.tokenHash !== undefined)
        await tx.$executeRaw`SELECT set_config('app.token_hash', ${c.tokenHash}, true)`;
      return work(tx);
    });
  }
}
