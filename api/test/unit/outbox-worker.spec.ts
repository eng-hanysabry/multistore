import { OutboxWorker, WorkerOptions } from '../../src/modules/mail/application/outbox-worker';
import {
  MailDailyLimitError,
  MailMessage,
  MailPermanentAuthError,
  MailSender,
  MailTransientError,
} from '../../src/modules/mail/domain/mail-sender';
import { MAX_ATTEMPTS, nextDailyReset, retryDelayMs } from '../../src/modules/mail/domain/outbox';
import { InMemoryOutboxStore } from '../support/in-memory-outbox-store';

const quiet = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const msg: MailMessage = { to: 'user@example.com', subject: 'Your code', text: 'Code 123456' };

class FakeClock {
  t = Date.UTC(2026, 10, 25, 12, 0, 0);
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
}
const opts = (c: FakeClock): WorkerOptions => ({
  leaseMs: 60_000,
  batchSize: 5,
  pollMs: 10,
  authCheckMs: 300_000,
  clock: c.now,
});

class ScriptedSender implements MailSender {
  sent: MailMessage[] = [];
  failWith: Error | undefined;
  authError: Error | undefined;
  send(m: MailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(m);
    return Promise.resolve();
  }
  checkAuth(): Promise<void> {
    return this.authError ? Promise.reject(this.authError) : Promise.resolve();
  }
}

describe('retry policy', () => {
  it('backs off 1, 5, 30, 120 seconds and gives up after 5 attempts', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([1000, 5000, 30000, 120000]);
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeUndefined();
  });
  it('next daily reset is just after the next UTC midnight', () => {
    expect(nextDailyReset(new Date(Date.UTC(2026, 10, 25, 23, 59))).toISOString()).toBe(
      '2026-11-26T00:01:00.000Z',
    );
  });
});

describe('OutboxWorker (IP-3 acceptance: outage and restart)', () => {
  it('drains after a simulated Gmail outage, nothing is lost', async () => {
    const c = new FakeClock();
    const store = new InMemoryOutboxStore();
    const sender = new ScriptedSender();
    const w = new OutboxWorker(store, sender, quiet, opts(c));
    const id = await store.enqueue(msg, c.now());

    sender.failWith = new MailTransientError('gmail error 503'); // outage
    expect(await w.tick()).toBe(0);
    expect(store.rows.get(id)?.status).toBe('PENDING');
    expect(w.current()).toEqual({ status: 'DEGRADED', reason: 'send_failing' });

    c.advance(500);
    expect(await w.tick()).toBe(0); // not due yet (1 s backoff)
    sender.failWith = undefined; // Gmail recovers
    c.advance(1500);
    expect(await w.tick()).toBe(1);
    expect(store.rows.get(id)?.status).toBe('SENT');
    expect(store.rows.get(id)?.message.text).toBe(''); // body not kept after sending
    expect(w.current()).toEqual({ status: 'OK' });
  });

  it('marks FAILED after five failed attempts', async () => {
    const c = new FakeClock();
    const store = new InMemoryOutboxStore();
    const sender = new ScriptedSender();
    sender.failWith = new MailTransientError('x');
    const w = new OutboxWorker(store, sender, quiet, opts(c));
    const id = await store.enqueue(msg, c.now());
    for (let i = 0; i < 8; i += 1) {
      await w.tick();
      c.advance(130_000);
    }
    expect(store.rows.get(id)?.status).toBe('FAILED');
    expect(store.rows.get(id)?.attempts).toBe(MAX_ATTEMPTS);
  });

  it('after a restart a new worker takes over a SENDING row whose lease expired', async () => {
    const c = new FakeClock();
    const store = new InMemoryOutboxStore();
    const id = await store.enqueue(msg, c.now());
    await store.claim(c.now(), 60_000, 5); // first process claimed it, then died mid-send
    expect(store.rows.get(id)?.status).toBe('SENDING');

    const sender = new ScriptedSender();
    const restarted = new OutboxWorker(store, sender, quiet, opts(c));
    expect(await restarted.tick()).toBe(0); // lease still valid
    c.advance(61_000);
    expect(await restarted.tick()).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(store.rows.get(id)?.status).toBe('SENT');
  });

  it('opens the circuit on invalid_grant, keeps rows, closes it when credentials work again', async () => {
    const c = new FakeClock();
    const store = new InMemoryOutboxStore();
    const sender = new ScriptedSender();
    const w = new OutboxWorker(store, sender, quiet, opts(c));
    const a = await store.enqueue(msg, c.now());
    const b = await store.enqueue(msg, c.now());
    sender.failWith = new MailPermanentAuthError('rejected');
    sender.authError = new MailPermanentAuthError('rejected');
    await w.tick();
    expect(w.current()).toEqual({ status: 'DEGRADED', reason: 'auth_failed' });
    expect([store.rows.get(a)?.status, store.rows.get(b)?.status]).toEqual(['PENDING', 'PENDING']);
    expect(store.rows.get(a)?.attempts).toBe(0); // auth failure does not burn attempts

    c.advance(61_000);
    expect(await w.tick()).toBe(0); // circuit open, credentials still bad
    sender.failWith = undefined;
    sender.authError = undefined;
    c.advance(301_000);
    expect(await w.tick()).toBe(2); // new refresh token deployed: outbox drains
    expect(w.current()).toEqual({ status: 'OK' });
  });

  it('pauses on the daily limit until the next day without dropping mail', async () => {
    const c = new FakeClock();
    const store = new InMemoryOutboxStore();
    const sender = new ScriptedSender();
    sender.failWith = new MailDailyLimitError('limit');
    const w = new OutboxWorker(store, sender, quiet, opts(c));
    const id = await store.enqueue(msg, c.now());
    await w.tick();
    expect(w.current()).toEqual({ status: 'DEGRADED', reason: 'daily_limit' });
    sender.failWith = undefined;
    c.advance(3_600_000);
    expect(await w.tick()).toBe(0);
    c.advance(13 * 3_600_000);
    expect(await w.tick()).toBe(1);
    expect(store.rows.get(id)?.status).toBe('SENT');
  });

  it('reports DEGRADED not_configured without a sender', () => {
    const w = new OutboxWorker(new InMemoryOutboxStore(), undefined, quiet);
    expect(w.current()).toEqual({ status: 'DEGRADED', reason: 'not_configured' });
  });

  it('start and stop run the loop', async () => {
    const store = new InMemoryOutboxStore();
    const sender = new ScriptedSender();
    const w = new OutboxWorker(store, sender, quiet, {
      ...opts(new FakeClock()),
      clock: () => new Date(),
      pollMs: 5,
    });
    await store.enqueue(msg, new Date(0));
    w.start();
    w.start();
    await new Promise((r) => setTimeout(r, 60));
    await w.stop();
    expect(sender.sent).toHaveLength(1);
  });
});
