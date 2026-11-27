import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaTenantTransactionRunner } from '../../infrastructure/prisma/tenant-transaction-runner';
import { CatalogService } from './application/catalog-service';
import { PublicCatalogService } from './application/public-catalog-service';
import { PrismaCategoryRepository } from './infrastructure/prisma-category-repository';
import { PrismaProductRepository } from './infrastructure/prisma-product-repository';
import { PrismaIdempotencyRepository } from './infrastructure/prisma-idempotency-repository';
import { PrismaPublicCatalogRepository } from './infrastructure/prisma-public-catalog-repository';
import { encodeCursor } from './domain/public-catalog-rules';
import { CatalogController } from './presentation/catalog.controller';
import { PublicCatalogController } from './presentation/public-catalog.controller';

/**
 * Merchant Catalog Core (IP-5 Step 3) and Public Catalog reads (IP-5 Step 4). Reuses
 * the global guard chain registered by the auth module (JwtAuthGuard, RolesGuard,
 * TenantResolverGuard, MerchantMembershipGuard) — no authentication or tenant-resolution
 * logic is duplicated here (6.3, 6.7).
 */
@Module({
  controllers: [CatalogController, PublicCatalogController],
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
    {
      provide: PublicCatalogService,
      useFactory: (db: PrismaService) =>
        new PublicCatalogService(
          new PrismaTenantTransactionRunner(db),
          new PrismaPublicCatalogRepository(),
          encodeCursor,
        ),
      inject: [PrismaService],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class CatalogModule {}
