import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { describeConfig, parseConfig } from './common/config/app-config';
import { SafeLogger } from './common/logging/safe-logger';

async function bootstrap(): Promise<void> {
  const cfg = parseConfig(process.env); // fails fast, never prints values
  const logger = new SafeLogger(undefined, { knownSecrets: [cfg.jwtSecret] });
  const app = await NestFactory.create(AppModule, { logger });
  await app.listen(cfg.port);
  logger.log('API started', describeConfig(cfg));
}

void bootstrap();
