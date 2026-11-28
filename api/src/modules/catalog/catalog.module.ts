import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '../../common/config/app-config';
import { APP_CONFIG } from '../../common/config/config.token';
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
import { PublicCatalogThrottlerGuard } from './presentation/public-catalog-throttler.guard';

/**
 * Merchant Catalog Core (IP-5 Step 3) and Public Catalog reads (IP-5 Step 4). Reuses
 * the global guard chain registered by the auth module (JwtAuthGuard, RolesGuard,
 * TenantResolverGuard, MerchantMembershipGuard) — no authentication or tenant-resolution
 * logic is duplicated here (6.3, 6.7).
 */
@Module({
  imports: [
    // G-12 (IP-5 Step 9): throttler providers (options + in-memory storage) for the
    // public catalog guard. The guard itself is applied with @UseGuards on
    // PublicCatalogController only — no global APP_GUARD (authorization 30039255/B2).
    // The default (unnamed) throttler is used so the standard Retry-After header is
    // emitted without a name suffix (30039263/B5). In-memory storage: counters are
    // per application instance, never distributed (B7).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        throttlers: [{ ttl: cfg.publicRateLimit.ttlMs, limit: cfg.publicRateLimit.limit }],
      }),
    }),
  ],
  controllers: [CatalogController, PublicCatalogController],
  providers: [
    PublicCatalogThrottlerGuard,
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
