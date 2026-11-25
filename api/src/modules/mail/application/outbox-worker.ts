import { LogPort } from '../../../common/ports/log-port';
import { MailStatus, MailStatusProvider } from '../../../common/ports/mail-status';
import { MailDailyLimitError, MailPermanentAuthError, MailSender } from '../domain/mail-sender';
import { nextDailyReset, OutboxRow, OutboxStore, retryDelayMs } from '../domain/outbox';

export interface WorkerOptions {
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly pollMs: number;
  /** How often to retest credentials while the circuit is open or as a no-op refresh. */
  readonly authCheckMs: number;
  readonly clock: () => Date;
}
export const DEFAULT_WORKER_OPTIONS: WorkerOptions = {
  leaseMs: 60_000,
  batchSize: 5,
  pollMs: 2_000,
  authCheckMs: 5 * 60_000,
  clock: () => new Date(),
};

/**
 * In-process outbox worker (10.7). It starts with the API and resumes every pending row, including
 * rows left in SENDING with an expired lease, so a restart or a sleep cannot lose a message.
 */
export class OutboxWorker implements MailStatusProvider {
  private authFailed = false;
  private pausedUntil: Date | undefined;
  private recentTransient = false;
  private lastAuthCheck = 0;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<number> | undefined;

  constructor(
    private readonly store: OutboxStore,
    private readonly sender: MailSender | undefined,
    private readonly log: LogPort,
    private readonly opts: WorkerOptions = DEFAULT_WORKER_OPTIONS,
  ) {}

  current(): MailStatus {
    if (!this.sender) return { status: 'DEGRADED', reason: 'not_configured' };
    if (this.authFailed) return { status: 'DEGRADED', reason: 'auth_failed' };
    if (this.pausedUntil && this.pausedUntil > this.opts.clock()) {
      return { status: 'DEGRADED', reason: 'daily_limit' };
    }
    if (this.recentTransient) return { status: 'DEGRADED', reason: 'send_failing' };
    return { status: 'OK' };
  }

  /** One pass. Returns how many messages were sent. */
  tick(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runOnce().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runOnce(): Promise<number> {
    const sender = this.sender;
    if (!sender) return 0;
    const now = this.opts.clock();
    if (this.authFailed) {
      // Half-open: retest the credentials now and then. Pending rows wait in the table.
      if (now.getTime() - this.lastAuthCheck < this.opts.authCheckMs) return 0;
      this.lastAuthCheck = now.getTime();
      try {
        await sender.checkAuth();
        this.authFailed = false;
        this.log.log('mail circuit closed');
      } catch {
        return 0;
      }
    }
    if (this.pausedUntil && this.pausedUntil > now) return 0;
    const rows = await this.store.claim(now, this.opts.leaseMs, this.opts.batchSize);
    let sent = 0;
    for (const row of rows) {
      if (await this.deliver(sender, row)) sent += 1;
      else if (this.authFailed || (this.pausedUntil && this.pausedUntil > now)) {
        // Remaining claimed rows go back untouched.
        const rest = rows.slice(rows.indexOf(row) + 1);
        for (const r of rest) await this.store.release(r.id, this.opts.clock(), 'deferred');
        break;
      }
    }
    return sent;
  }

  private async deliver(sender: MailSender, row: OutboxRow): Promise<boolean> {
    const now = this.opts.clock();
    try {
      await sender.send(row.message);
      await this.store.markSent(row.id, this.opts.clock());
      this.recentTransient = false;
      return true;
    } catch (err) {
      if (err instanceof MailPermanentAuthError) {
        this.authFailed = true;
        this.lastAuthCheck = now.getTime();
        await this.store.release(row.id, new Date(now.getTime() + 60_000), 'auth_failed');
        this.log.error('mail auth failure, circuit open', { outboxId: row.id });
        return false;
      }
      if (err instanceof MailDailyLimitError) {
        this.pausedUntil = nextDailyReset(now);
        await this.store.release(row.id, this.pausedUntil, 'daily_limit');
        this.log.warn('mail daily limit reached, sends paused', { until: this.pausedUntil });
        return false;
      }
      this.recentTransient = true;
      const delay = retryDelayMs(row.attempts);
      const reason = err instanceof Error ? err.name : 'error';
      if (delay === undefined) {
        await this.store.markFailed(row.id, reason);
        this.log.error('mail permanently failed after retries', { outboxId: row.id });
      } else {
        await this.store.markRetry(row.id, new Date(now.getTime() + delay), reason);
      }
      return false;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      this.tick()
        .catch((e: unknown) => {
          this.log.error('outbox tick failed', { error: e instanceof Error ? e.name : 'error' });
        })
        .finally(() => {
          if (this.running) {
            this.timer = setTimeout(loop, this.opts.pollMs);
            this.timer.unref();
          }
        });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }
}
