import { Module } from '@nestjs/common';
import { AppConfigModule } from './common/config/config.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { MediaModule } from './modules/media/media.module';

/**
 * IP-3: health endpoints and the mail outbox. IP-4: identity and access (auth module).
 * IP-5 Step 3: merchant catalog core (catalog module). Step 6: media (media module).
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    MediaModule,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class AppModule {}
