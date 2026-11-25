import { PrismaClient } from '@prisma/client';
import { HealthService } from '../../src/modules/health/application/health.service';
import { assertRuntimeRole } from '../../src/modules/health/domain/database-probe';
import { PrismaDatabaseProbe } from '../../src/modules/health/infrastructure/prisma-database-probe';
import { OutboxWorker } from '../../src/modules/mail/application/outbox-worker';
import {
  MailMessage,
  MailSender,
  MailTransientError,
} from '../../src/modules/mail/domain/mail-sender';
import { PrismaOutboxStore } from '../../src/modules/mail/infrastructure/prisma-outbox-store';
import { appDatabaseUrl, applyMigration, setupDatabase } from './harness';

const quiet = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const msg: MailMessage = { to: 'user@example.com', subject: 'Your code', text: 'Code 654321' };

let db: PrismaClient; // pool of ONE connection: every query reuses the same pooled connection
let store: PrismaOutboxStore;

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  db = new PrismaClient({ datasourceUrl: appDatabaseUrl() });
  store = new PrismaOutboxStore(db);
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  const { superClient } = await import('./harness');
  const s = superClient();
  await s.connect();
  await s.query('TRUNCATE email_outbox');
  await s.end();
});

describe('IP-3 against real PostgreSQL as multistore_app', () => {
  it('connects as multistore_app, not a superuser, no BYPASSRLS (boot check passes)', async () => {
    const probe = new PrismaDatabaseProbe(db);
    expect(await probe.runtimeRole()).toEqual({
      user: 'multistore_app',
      superuser: false,
      bypassRls: false,
    });
    await expect(assertRuntimeRole(probe)).resolves.toBeUndefined();
  });

  it('readiness canary passes, including after a prior transaction set context on this connection', async () => {
    const probe = new PrismaDatabaseProbe(db);
    expect(await probe.readiness()).toEqual({ databaseOk: true, rlsCanaryOk: true });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true)`;
    });
    // Same connection now returns '' (not NULL) for app.tenant_id: NULLIF must keep this a zero-row result.
    expect(await probe.readiness()).toEqual({ databaseOk: true, rlsCanaryOk: true });
  });

  it('readiness is 503 and liveness stays 200 when the database is down', async () => {
    const dead = new PrismaClient({
      datasourceUrl:
        'postgresql://multistore_app:x@127.0.0.1:1/postgres?connect_timeout=1&connection_limit=1',
    });
    const svc = new HealthService(
      new PrismaDatabaseProbe(dead),
      { current: () => ({ status: 'OK' }) },
      't',
    );
    expect(svc.live().status).toBe('ok');
    expect(await svc.ready()).toMatchObject({ status: 'unavailable', database: 'down' });
    await dead.$disconnect();
  });

  it('the app role can read and write the outbox but not delete rows or read the canary unscoped', async () => {
    const id = await store.enqueue(msg, new Date());
    await expect(db.$executeRaw`DELETE FROM email_outbox WHERE id = ${id}::uuid`).rejects.toThrow();
    const unscoped = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM rls_canary`;
    expect(Number(unscoped[0]?.n)).toBe(0);
  });

  it('enqueue, claim, retry, release and markSent behave as the worker expects', async () => {
    const now = new Date('2026-11-25T12:00:00Z');
    const id = await store.enqueue(msg, now);
    const first = await store.claim(now, 60_000, 5);
    expect(first.map((r) => [r.id, r.attempts])).toEqual([[id, 1]]);
    expect(await store.claim(now, 60_000, 5)).toEqual([]); // leased
    await store.markRetry(id, new Date(now.getTime() + 1000), 'MailTransientError');
    expect(await store.claim(now, 60_000, 5)).toEqual([]); // not due
    const again = await store.claim(new Date(now.getTime() + 1500), 60_000, 5);
    expect(again[0]?.attempts).toBe(2);
    await store.release(id, now, 'auth_failed');
    const afterRelease = await store.claim(now, 60_000, 5);
    expect(afterRelease[0]?.attempts).toBe(2); // release did not burn the attempt
    await store.markSent(id, now);
    const row = await db.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'SENT', bodyText: '' });
  });

  it('two concurrent claims never take the same row', async () => {
    const now = new Date();
    for (let i = 0; i < 6; i += 1) await store.enqueue(msg, now);
    const [a, b] = await Promise.all([store.claim(now, 60_000, 6), store.claim(now, 60_000, 6)]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('drains after a Gmail outage and after a simulated restart, with rows persisted in PostgreSQL', async () => {
    let t = Date.parse('2026-11-25T12:00:00Z');
    const clock = (): Date => new Date(t);
    const sent: MailMessage[] = [];
    let down = true;
    const sender: MailSender = {
      send: (m) =>
        down ? Promise.reject(new MailTransientError('503')) : (sent.push(m), Promise.resolve()),
      checkAuth: () => Promise.resolve(),
    };
    const opts = { leaseMs: 60_000, batchSize: 5, pollMs: 10, authCheckMs: 300_000, clock };
    const id = await store.enqueue(msg, clock());

    const w1 = new OutboxWorker(store, sender, quiet, opts);
    expect(await w1.tick()).toBe(0); // outage
    t += 2_000;
    down = false;
    // The process dies mid-send: claim without finishing, then a new worker (new process) starts later.
    await store.claim(clock(), 60_000, 5);
    const restarted = new OutboxWorker(new PrismaOutboxStore(db), sender, quiet, opts);
    expect(await restarted.tick()).toBe(0); // lease still valid
    t += 61_000;
    expect(await restarted.tick()).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await db.emailOutbox.findUniqueOrThrow({ where: { id } })).status).toBe('SENT');
  });
});
