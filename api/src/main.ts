import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { describeConfig, parseConfig } from './common/config/app-config';
import { configureApp } from './common/http/configure-app';
import { SafeLogger } from './common/logging/safe-logger';
import {
  assertRuntimeRole,
  DATABASE_PROBE,
  DatabaseProbe,
  RoleViolationError,
} from './modules/health/domain/database-probe';

async function bootstrap(): Promise<void> {
  const cfg = parseConfig(process.env); // fails fast, never prints values
  const logger = new SafeLogger(undefined, {
    knownSecrets: [
      cfg.jwtSecret,
      ...(cfg.gmail ? [cfg.gmail.clientSecret, cfg.gmail.refreshToken] : []),
    ],
  });
  const app = await NestFactory.create(AppModule, { logger });
  configureApp(app);
  app.enableShutdownHooks();

  // Boot check (10.7): refuse to start as the wrong role. An unreachable database is not a reason
  // to refuse: /health/ready reports 503 and the API keeps answering liveness.
  try {
    await assertRuntimeRole(app.get<DatabaseProbe>(DATABASE_PROBE));
  } catch (err) {
    if (err instanceof RoleViolationError) throw err;
    logger.warn('database not reachable at boot; readiness will report 503');
  }
  await app.listen(cfg.port, '0.0.0.0');
  logger.log('API started', describeConfig(cfg));
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : 'startup failed'}\n`);
  process.exit(1);
});
