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
import { PrismaOutboxStore } from './infrastructure/prisma-outbox-store';

/** Starts the in-process worker with the API and stops it on shutdown (10.7). */
@Injectable()
export class OutboxRunner implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(OutboxWorker) private readonly worker: OutboxWorker) {}
  onModuleInit(): void {
    this.worker.start();
  }
  async onModuleDestroy(): Promise<void> {
    await this.worker.stop();
  }
}

@Module({
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
    OutboxRunner,
  ],
  exports: [MAIL_STATUS, OUTBOX_STORE],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class MailModule {}
