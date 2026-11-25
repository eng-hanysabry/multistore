import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';

/** IP-3: health endpoints and the mail outbox. Feature modules arrive from IP-4. */
@Module({ imports: [AppConfigModule, PrismaModule, MailModule, HealthModule] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class AppModule {}
