import 'reflect-metadata';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

/** Generates contracts/openapi.json from code. `--check` fails when the committed file is out of date. */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
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

void main();
