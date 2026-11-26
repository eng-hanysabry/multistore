import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ResolvedTenant, TenantResolver } from '../../common/tenancy/tenant-resolver';
import { TxHandle } from '../../common/tenancy/tenant-transaction-runner';
import { PrismaService } from './prisma.service';
import { PrismaTenantTransactionRunner } from './tenant-transaction-runner';

const CACHE_TTL_MS = 60_000; // spec 6.7: short cache; a suspension takes effect within it

interface CacheEntry {
  readonly value: ResolvedTenant | null;
  readonly expiresAt: number;
}

/**
 * Resolves the URL tenant code through the tenant_resolve RLS policy as multistore_app
 * (GUEST context): only ACTIVE tenants match, so suspended tenants resolve to null like
 * unknown ones. Lookups (positive and negative) are cached for 60 seconds (6.7).
 */
@Injectable()
export class PrismaTenantResolver implements TenantResolver {
  private readonly runner: PrismaTenantTransactionRunner;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(db: PrismaService) {
    this.runner = new PrismaTenantTransactionRunner(db);
  }

  async resolve(tenantCode: string): Promise<ResolvedTenant | null> {
    const now = Date.now();
    const hit = this.cache.get(tenantCode);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = await this.runner.run({ role: 'GUEST', tenantCode }, async (tx: TxHandle) => {
      const rows = await (tx as PrismaClient).$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM tenants WHERE code = ${tenantCode}`;
      const id = rows[0]?.id;
      return id ? { tenantId: id, tenantCode } : null;
    });
    this.cache.set(tenantCode, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }
}
