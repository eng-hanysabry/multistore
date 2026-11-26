import { Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../common/config/app-config';
import { APP_CONFIG } from '../../common/config/config.token';
import { SafeLogger } from '../../common/logging/safe-logger';
import { MAIL_STATUS } from '../../common/ports/mail-status';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxWorker } from './application/outbox-worker';
import { MAIL_SENDER, MailSender } from './domain/mail-sender';
import { OUTBOX_STORE, OutboxStore } from './domain/outbox';
import { GmailApiMailSender } from './infrastructure/gmail-api-mail-sender';
import { createGoogleGmailTransport } from './infrastructure/google-gmail-transport';
import { OutboxService } from './application/outbox-service';
import { OutboxDrainController } from './presentation/outbox-drain.controller';
import { PrismaOutboxStore } from './infrastructure/prisma-outbox-store';

/** Starts the in-process worker with the API and stops it on shutdown (10.7). */
@Injectable()
export class OutboxRunner implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(OutboxWorker) private readonly worker: OutboxWorker,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}
  onModuleInit(): void {
    // Serverless host: no background loop. Mail is sent after queuing and by the scheduled sweep.
    if (this.cfg.outboxMode === 'loop') this.worker.start();
  }
  async onModuleDestroy(): Promise<void> {
    await this.worker.stop();
  }
}

@Module({
  controllers: [OutboxDrainController],
  providers: [
    {
      provide: OUTBOX_STORE,
      inject: [PrismaService],
      useFactory: (db: PrismaService): OutboxStore => new PrismaOutboxStore(db),
    },
    {
      provide: MAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig): MailSender | undefined =>
        cfg.gmail
          ? new GmailApiMailSender(createGoogleGmailTransport(cfg.gmail), cfg.gmail.account)
          : undefined,
    },
    {
      provide: OutboxWorker,
      inject: [OUTBOX_STORE, MAIL_SENDER],
      useFactory: (store: OutboxStore, sender: MailSender | undefined): OutboxWorker =>
        new OutboxWorker(store, sender, new SafeLogger()),
    },
    { provide: MAIL_STATUS, useExisting: OutboxWorker },
    {
      provide: OutboxService,
      inject: [OUTBOX_STORE, OutboxWorker, APP_CONFIG],
      useFactory: (store: OutboxStore, worker: OutboxWorker, cfg: AppConfig): OutboxService =>
        new OutboxService(store, worker, cfg.outboxMode),
    },
    OutboxRunner,
  ],
  exports: [MAIL_STATUS, OUTBOX_STORE, OutboxService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class MailModule {}
