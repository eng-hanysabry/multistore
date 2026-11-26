import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MembershipChecker } from '../../common/tenancy/membership-checker';
import { TxHandle } from '../../common/tenancy/tenant-transaction-runner';
import { AppRole } from '../../common/tenancy/tenant-context';
import { PrismaService } from './prisma.service';
import { PrismaTenantTransactionRunner } from './tenant-transaction-runner';

/**
 * Membership re-check through the membership_self RLS policy as multistore_app: a
 * MERCHANT context sees only its own rows, so the query can never read another user's
 * membership (spec 6.3 rule 2).
 */
@Injectable()
export class PrismaMembershipChecker implements MembershipChecker {
  private readonly runner: PrismaTenantTransactionRunner;

  constructor(db: PrismaService) {
    this.runner = new PrismaTenantTransactionRunner(db);
  }

  async membershipRole(userId: string, tenantId: string): Promise<AppRole | null> {
    return this.runner.run({ role: 'MERCHANT', userId, tenantId }, async (tx: TxHandle) => {
      const rows = await (tx as PrismaClient).$queryRaw<{ role: string }[]>`
        SELECT role FROM memberships
        WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'ACTIVE'`;
      return rows[0]?.role === 'MERCHANT' ? 'MERCHANT' : null;
    });
  }
}
