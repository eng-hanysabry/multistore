import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';

/** IP-3: health endpoints and the mail outbox. IP-4: identity and access (auth module). */
@Module({ imports: [AppConfigModule, PrismaModule, MailModule, HealthModule, AuthModule] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class AppModule {}
