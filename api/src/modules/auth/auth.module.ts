import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from '../../common/config/app-config';
import { APP_CONFIG } from '../../common/config/config.token';
import { ACCESS_TOKEN_VERIFIER } from '../../common/auth/verified-token';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { TENANT_RESOLVER } from '../../common/tenancy/tenant-resolver';
import { MEMBERSHIP_CHECKER } from '../../common/tenancy/membership-checker';
import { TenantResolverGuard } from '../../common/tenancy/tenant-resolver.guard';
import { MerchantMembershipGuard } from '../../common/tenancy/merchant-membership.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaTenantTransactionRunner } from '../../infrastructure/prisma/tenant-transaction-runner';
import { PrismaTenantResolver } from '../../infrastructure/prisma/prisma-tenant-resolver';
import { PrismaMembershipChecker } from '../../infrastructure/prisma/prisma-membership-checker';
import { MailModule } from '../mail/mail.module';
import { OutboxService } from '../mail/application/outbox-service';
import { AuthService } from './application/auth-service';
import { Argon2SecretHasher } from './infrastructure/argon2-secret-hasher';
import { JwtAccessTokenSigner } from './infrastructure/jwt-access-token-signer';
import { PrismaAuthStore } from './infrastructure/prisma-auth-store';
import { AuthController } from './presentation/auth.controller';

/**
 * Identity and access (IP-4). Wires the auth module and registers the global guard
 * chain in spec 6.3 order: verify the token, check the role claim, resolve the URL
 * tenant server-side, re-check merchant membership. No passport, no throttler
 * dependency (approved dependency list).
 */
@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    {
      provide: JwtAccessTokenSigner,
      useFactory: (cfg: AppConfig) => new JwtAccessTokenSigner(cfg.jwtSecret),
      inject: [APP_CONFIG],
    },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: JwtAccessTokenSigner },
    { provide: TENANT_RESOLVER, useClass: PrismaTenantResolver },
    { provide: MEMBERSHIP_CHECKER, useClass: PrismaMembershipChecker },
    {
      provide: AuthService,
      useFactory: (db: PrismaService, signer: JwtAccessTokenSigner, outbox: OutboxService) =>
        new AuthService(
          new PrismaTenantTransactionRunner(db),
          new PrismaAuthStore(),
          new Argon2SecretHasher(),
          signer,
          outbox,
        ),
      inject: [PrismaService, JwtAccessTokenSigner, OutboxService],
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantResolverGuard },
    { provide: APP_GUARD, useClass: MerchantMembershipGuard },
  ],
  exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
export class AuthModule {}
