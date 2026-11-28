import { Module } from '@nestjs/common';
import { AppConfig } from '../../common/config/app-config';
import { APP_CONFIG } from '../../common/config/config.token';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaTenantTransactionRunner } from '../../infrastructure/prisma/tenant-transaction-runner';
import { MediaService } from './application/media-service';
import { StorageProvider } from './domain/storage-provider';
import { PrismaMediaRepository } from './infrastructure/prisma-media-repository';
import { PrismaMediaIdempotencyRepository } from './infrastructure/prisma-media-idempotency-repository';
import { SharpImageProcessor } from './infrastructure/sharp-image-processor';
import { LocalStorageDouble } from './infrastructure/local-storage-double';
import {
  createDriveFilesClient,
  DriveStorageProvider,
} from './infrastructure/drive-storage-provider';
import { MediaController } from './presentation/media.controller';
import { MediaImageController } from './presentation/media-image.controller';

/**
 * Media module (IP-5 Step 6): merchant upload/replace/delete, authorized serving, sharp
 * processing, StorageProvider persistence. Provider selection is explicit configuration
 * (Step 8, B6): STORAGE_PROVIDER=local (default) keeps the approved in-memory double
 * for local runs and tests; STORAGE_PROVIDER=drive selects the Drive adapter, with
 * parseConfig failing fast and safely when any GOOGLE_DRIVE_* variable is missing — so
 * a half-configured deployment never starts. Building the client performs no OAuth
 * flow or network call; only a files.* call would. No credential is ever logged: config
 * values go nowhere near the logger and the redaction sink knows the key patterns. The
 * global guard chain (6.3) is registered by the auth module and not duplicated here.
 */
const storageProviderOf = (cfg: AppConfig): StorageProvider => {
  if (cfg.storageProvider === 'drive') {
    // parseConfig guarantees drive config is complete when the provider is 'drive'.
    const drive = cfg.drive as NonNullable<AppConfig['drive']>;
    return new DriveStorageProvider(createDriveFilesClient(drive), drive.folderId);
  }
  return new LocalStorageDouble();
};

@Module({
  controllers: [MediaController, MediaImageController],
  providers: [
    {
      provide: MediaService,
      useFactory: (db: PrismaService, cfg: AppConfig) =>
        new MediaService(
          new PrismaTenantTransactionRunner(db),
          new PrismaMediaRepository(),
          new PrismaMediaIdempotencyRepository(),
          storageProviderOf(cfg),
          new SharpImageProcessor(),
        ),
      inject: [PrismaService, APP_CONFIG],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class MediaModule {}
