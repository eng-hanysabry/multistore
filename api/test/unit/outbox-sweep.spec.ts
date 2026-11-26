import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppConfig, parseConfig } from '../../src/common/config/app-config';
import { APP_CONFIG } from '../../src/common/config/config.token';
import { OutboxService } from '../../src/modules/mail/application/outbox-service';
import { OutboxWorker } from '../../src/modules/mail/application/outbox-worker';
import { OutboxStore } from '../../src/modules/mail/domain/outbox';
import { OutboxDrainController } from '../../src/modules/mail/presentation/outbox-drain.controller';

const SECRET = 'c'.repeat(40);
const baseEnv = {
  DATABASE_URL: 'postgresql://multistore_app:x@h:6543/postgres',
  JWT_SECRET: 'j'.repeat(40),
};
const msg = { to: 'a@example.com', subject: 's', text: 't' };

async function build(cfg: Partial<AppConfig>, ticks: number[]): Promise<INestApplication> {
  const full = {
    ...parseConfig({ ...baseEnv, OUTBOX_MODE: 'sweep', CRON_SECRET: SECRET }),
    ...cfg,
  };
  const worker = { tick: () => Promise.resolve(ticks.shift() ?? 0) };
  @Module({
    controllers: [OutboxDrainController],
    providers: [
      { provide: APP_CONFIG, useValue: full },
      { provide: OutboxWorker, useValue: worker },
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
  class M {}
  const app = await NestFactory.create(M, { logger: false });
  await app.init();
  return app;
}

describe('serverless outbox: config', () => {
  it('defaults to loop mode and needs no cron secret', () => {
    const c = parseConfig(baseEnv);
    expect(c.outboxMode).toBe('loop');
    expect(c.cronSecret).toBeUndefined();
  });
  it('sweep mode requires a long cron secret', () => {
    expect(() => parseConfig({ ...baseEnv, OUTBOX_MODE: 'sweep' })).toThrow(
      /CRON_SECRET is required/,
    );
    expect(() => parseConfig({ ...baseEnv, OUTBOX_MODE: 'sweep', CRON_SECRET: 'short' })).toThrow(
      /at least 32/,
    );
    expect(() => parseConfig({ ...baseEnv, OUTBOX_MODE: 'weird' })).toThrow(/loop or sweep/);
  });
});

describe('POST /internal/outbox/drain', () => {
  it('returns 404 when no secret is configured', async () => {
    const app = await build({ cronSecret: undefined }, []);
    await request(app.getHttpServer()).post('/internal/outbox/drain').expect(404);
    await app.close();
  });
  it('rejects a missing or wrong bearer token', async () => {
    const app = await build({}, [1]);
    await request(app.getHttpServer()).post('/internal/outbox/drain').expect(401);
    await request(app.getHttpServer())
      .post('/internal/outbox/drain')
      .set('Authorization', `Bearer ${'d'.repeat(40)}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/outbox/drain')
      .set('Authorization', SECRET)
      .expect(401);
    await app.close();
  });
  it('runs passes until nothing more is due and returns counts only', async () => {
    const app = await build({}, [5, 2, 0, 9]);
    const res = await request(app.getHttpServer())
      .post('/internal/outbox/drain')
      .set('Authorization', `Bearer ${SECRET}`)
      .expect(200);
    expect(res.body).toEqual({ sent: 7, passes: 3 });
    await app.close();
  });
});

describe('OutboxService', () => {
  const store = (calls: string[]): OutboxStore =>
    ({ enqueue: () => (calls.push('enqueue'), Promise.resolve('id-1')) }) as unknown as OutboxStore;

  it('loop mode only queues', async () => {
    const calls: string[] = [];
    const svc = new OutboxService(
      store(calls),
      { tick: () => (calls.push('tick'), Promise.resolve(1)) },
      'loop',
    );
    expect(await svc.queue(msg)).toBe('id-1');
    expect(calls).toEqual(['enqueue']);
  });
  it('sweep mode queues first, then makes one immediate attempt', async () => {
    const calls: string[] = [];
    const svc = new OutboxService(
      store(calls),
      { tick: () => (calls.push('tick'), Promise.resolve(1)) },
      'sweep',
    );
    await svc.queue(msg);
    expect(calls).toEqual(['enqueue', 'tick']);
  });
  it('a failing or slow immediate attempt never fails the caller', async () => {
    const failing = new OutboxService(
      store([]),
      { tick: () => Promise.reject(new Error('boom')) },
      'sweep',
    );
    await expect(failing.queue(msg)).resolves.toBe('id-1');
    const slow = new OutboxService(
      store([]),
      { tick: () => new Promise<number>(() => undefined) },
      'sweep',
      20,
    );
    await expect(slow.queue(msg)).resolves.toBe('id-1');
  });
});
