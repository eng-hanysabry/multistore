import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { configureApp } from '../../src/common/http/configure-app';
import { MailStatusProvider } from '../../src/common/ports/mail-status';
import {
  assertRuntimeRole,
  DatabaseProbe,
  DatabaseReadiness,
  RoleViolationError,
  RuntimeRole,
} from '../../src/modules/health/domain/database-probe';
import {
  HealthService,
  READINESS_CACHE_MS,
  READINESS_TIMEOUT_MS,
} from '../../src/modules/health/application/health.service';
import { HealthController } from '../../src/modules/health/presentation/health.controller';

class FakeProbe implements DatabaseProbe {
  calls = 0;
  next: () => Promise<DatabaseReadiness> = () =>
    Promise.resolve({ databaseOk: true, rlsCanaryOk: true });
  role: RuntimeRole = { user: 'multistore_app', superuser: false, bypassRls: false };
  readiness(): Promise<DatabaseReadiness> {
    this.calls += 1;
    return this.next();
  }
  runtimeRole(): Promise<RuntimeRole> {
    return Promise.resolve(this.role);
  }
}

async function build(probe: DatabaseProbe, mail: MailStatusProvider, clock?: () => number) {
  @Module({
    controllers: [HealthController],
    providers: [
      { provide: HealthService, useValue: new HealthService(probe, mail, 'test', clock) },
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module marker
  class TestModule {}
  const app: INestApplication = await NestFactory.create(TestModule, { logger: false });
  configureApp(app);
  await app.init();
  return app;
}
const okMail: MailStatusProvider = { current: () => ({ status: 'OK' }) };

describe('health endpoints (spec 10.7)', () => {
  it('readiness is 200 with the database up and the RLS canary passing', async () => {
    const app = await build(new FakeProbe(), okMail);
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'ready',
      database: 'up',
      rlsCanary: 'ok',
      mail: { status: 'OK' },
      version: 'test',
    });
    await app.close();
  });

  it('readiness is 503 with Retry-After when the database is down, liveness stays 200', async () => {
    const probe = new FakeProbe();
    probe.next = () => Promise.reject(new Error('ECONNREFUSED'));
    const app = await build(probe, okMail);
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(ready.body).toMatchObject({ status: 'unavailable', database: 'down' });
    expect(ready.headers['retry-after']).toBe('5');
    const live = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(live.body).toEqual({ status: 'ok', version: 'test' });
    expect(probe.calls).toBe(1); // liveness never touches the database
    await app.close();
  });

  it('readiness is 503 when the canary fails (RLS context broken)', async () => {
    const probe = new FakeProbe();
    probe.next = () => Promise.resolve({ databaseOk: true, rlsCanaryOk: false });
    const app = await build(probe, okMail);
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body).toMatchObject({ database: 'up', rlsCanary: 'failed' });
    await app.close();
  });

  it('reports mail DEGRADED without failing readiness, and never calls Gmail', async () => {
    const mail: MailStatusProvider = {
      current: () => ({ status: 'DEGRADED', reason: 'auth_failed' }),
    };
    const app = await build(new FakeProbe(), mail);
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.mail).toEqual({ status: 'DEGRADED', reason: 'auth_failed' });
    await app.close();
  });

  it('caches the database result for about 5 seconds', async () => {
    let now = 1_000;
    const probe = new FakeProbe();
    const svc = new HealthService(probe, okMail, 'test', () => now);
    await svc.ready();
    await svc.ready();
    expect(probe.calls).toBe(1);
    now += READINESS_CACHE_MS + 1;
    await svc.ready();
    expect(probe.calls).toBe(2);
  });

  it('times out a hanging database check after 2 seconds as 503', async () => {
    jest.useFakeTimers();
    try {
      const probe = new FakeProbe();
      probe.next = () => new Promise(() => undefined);
      const svc = new HealthService(probe, okMail, 'test');
      const pending = svc.ready();
      await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS + 1);
      expect((await pending).status).toBe('unavailable');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('secure headers (D1, helmet) and request timeout', () => {
  it('sets helmet headers', async () => {
    const app = await build(new FakeProbe(), okMail);
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });
});

describe('boot role check (10.7)', () => {
  it('accepts multistore_app without superuser or BYPASSRLS', async () => {
    await expect(assertRuntimeRole(new FakeProbe())).resolves.toBeUndefined();
  });
  it.each([
    [{ user: 'postgres', superuser: true, bypassRls: true }],
    [{ user: 'multistore_admin', superuser: false, bypassRls: false }],
    [{ user: 'multistore_app', superuser: false, bypassRls: true }],
  ])('refuses to start as %j', async (role) => {
    const p = new FakeProbe();
    p.role = role;
    await expect(assertRuntimeRole(p)).rejects.toBeInstanceOf(RoleViolationError);
  });
});
