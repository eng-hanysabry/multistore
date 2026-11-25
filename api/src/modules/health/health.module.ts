import { Module } from '@nestjs/common';
import { MAIL_STATUS, MailStatusProvider } from '../../common/ports/mail-status';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MailModule } from '../mail/mail.module';
import { DATABASE_PROBE, DatabaseProbe } from './domain/database-probe';
import { HealthService } from './application/health.service';
import { PrismaDatabaseProbe } from './infrastructure/prisma-database-probe';
import { HealthController } from './presentation/health.controller';

@Module({
  imports: [MailModule],
  controllers: [HealthController],
  providers: [
    {
      provide: DATABASE_PROBE,
      inject: [PrismaService],
      useFactory: (db: PrismaService): DatabaseProbe => new PrismaDatabaseProbe(db),
    },
    {
      provide: HealthService,
      inject: [DATABASE_PROBE, MAIL_STATUS],
      useFactory: (db: DatabaseProbe, mail: MailStatusProvider): HealthService =>
        new HealthService(db, mail, process.env['RENDER_GIT_COMMIT']?.slice(0, 7) ?? 'dev'),
    },
  ],
  exports: [DATABASE_PROBE],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class HealthModule {}
