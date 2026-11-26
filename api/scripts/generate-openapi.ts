import 'reflect-metadata';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Module } from '@nestjs/common';
import { HealthService } from '../src/modules/health/application/health.service';
import { HealthController } from '../src/modules/health/presentation/health.controller';
import { AuthService } from '../src/modules/auth/application/auth-service';
import { AuthController } from '../src/modules/auth/presentation/auth.controller';

/**
 * The contract is built from controllers only, with stub providers, so it needs no database, no
 * environment and no network. Every new controller is added to this list.
 */
@Module({
  controllers: [HealthController, AuthController],
  providers: [
    { provide: HealthService, useValue: {} },
    { provide: AuthService, useValue: {} },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
class ContractModule {}

/** Generates contracts/openapi.json from code. `--check` fails when the committed file is out of date. */
async function main(): Promise<void> {
  const app = await NestFactory.create(ContractModule, { logger: false });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('MultiStore API').setVersion('0.0.1').build(),
  );
  await app.close();
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const target = join(__dirname, '..', '..', 'contracts', 'openapi.json');
  if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== text) {
      console.error(
        'contracts/openapi.json is out of date: run `npm run contract:generate` in api/',
      );
      process.exit(1);
    }
    console.log('contract check: contracts/openapi.json is up to date');
    return;
  }
  writeFileSync(target, text);
  console.log('wrote contracts/openapi.json');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'contract generation failed');
  process.exit(1);
});
