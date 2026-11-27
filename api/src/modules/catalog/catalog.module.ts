import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaTenantTransactionRunner } from '../../infrastructure/prisma/tenant-transaction-runner';
import { CatalogService } from './application/catalog-service';
import { PrismaCategoryRepository } from './infrastructure/prisma-category-repository';
import { PrismaProductRepository } from './infrastructure/prisma-product-repository';
import { PrismaIdempotencyRepository } from './infrastructure/prisma-idempotency-repository';
import { CatalogController } from './presentation/catalog.controller';

/**
 * Merchant Catalog Core (IP-5 Step 3). Reuses the global guard chain registered by the
 * auth module (JwtAuthGuard, RolesGuard, TenantResolverGuard, MerchantMembershipGuard) —
 * no authentication or tenant-resolution logic is duplicated here (6.3, 6.7).
 */
@Module({
  controllers: [CatalogController],
  providers: [
    {
      provide: CatalogService,
      useFactory: (db: PrismaService) =>
        new CatalogService(
          new PrismaTenantTransactionRunner(db),
          new PrismaCategoryRepository(),
          new PrismaProductRepository(),
          new PrismaIdempotencyRepository(),
        ),
      inject: [PrismaService],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class CatalogModule {}
