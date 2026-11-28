import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaTenantTransactionRunner } from '../../infrastructure/prisma/tenant-transaction-runner';
import { MediaService } from './application/media-service';
import { PrismaMediaRepository } from './infrastructure/prisma-media-repository';
import { PrismaMediaIdempotencyRepository } from './infrastructure/prisma-media-idempotency-repository';
import { SharpImageProcessor } from './infrastructure/sharp-image-processor';
import { LocalStorageDouble } from './infrastructure/local-storage-double';
import { MediaController } from './presentation/media.controller';
import { MediaImageController } from './presentation/media-image.controller';

/**
 * Media module (IP-5 Step 6): merchant upload/replace/delete, authorized serving, sharp
 * processing, StorageProvider persistence. The provider is the approved LOCAL test
 * double — local validation only, not persistent production storage; the Drive adapter
 * (Step 8, separately approved) swaps in behind the same port and contract suite. The
 * global guard chain (6.3) is registered by the auth module and not duplicated here.
 */
@Module({
  controllers: [MediaController, MediaImageController],
  providers: [
    {
      provide: MediaService,
      useFactory: (db: PrismaService) =>
        new MediaService(
          new PrismaTenantTransactionRunner(db),
          new PrismaMediaRepository(),
          new PrismaMediaIdempotencyRepository(),
          new LocalStorageDouble(),
          new SharpImageProcessor(),
        ),
      inject: [PrismaService],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class MediaModule {}
