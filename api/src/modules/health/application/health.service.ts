import { MailStatus, MailStatusProvider } from '../../../common/ports/mail-status';
import { DatabaseProbe } from '../domain/database-probe';

export interface LiveBody {
  readonly status: 'ok';
  readonly version: string;
}
export interface ReadyBody {
  readonly status: 'ready' | 'unavailable';
  readonly database: 'up' | 'down';
  readonly rlsCanary: 'ok' | 'failed' | 'unknown';
  readonly mail: MailStatus;
  readonly version: string;
}

export const READINESS_TIMEOUT_MS = 2_000; // 10.7
export const READINESS_CACHE_MS = 5_000; // 10.7

export class HealthService {
  private cached: { at: number; body: ReadyBody } | undefined;

  constructor(
    private readonly db: DatabaseProbe,
    private readonly mail: MailStatusProvider,
    private readonly version: string,
    private readonly clock: () => number = Date.now,
  ) {}

  /** No database, no Gmail: a dependency outage must never fail liveness (10.7). */
  live(): LiveBody {
    return { status: 'ok', version: this.version };
  }

  async ready(): Promise<ReadyBody> {
    const now = this.clock();
    const hit = this.cached;
    const base = hit && now - hit.at < READINESS_CACHE_MS ? hit.body : await this.check(now);
    // Mail is read live from the circuit state on every call (never calls Gmail).
    return { ...base, mail: this.mail.current() };
  }

  private async check(now: number): Promise<ReadyBody> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), READINESS_TIMEOUT_MS);
    });
    let body: ReadyBody;
    try {
      const r = await Promise.race([this.db.readiness(), timeout]);
      if (r === 'timeout') throw new Error('timeout');
      const ok = r.databaseOk && r.rlsCanaryOk;
      body = {
        status: ok ? 'ready' : 'unavailable',
        database: r.databaseOk ? 'up' : 'down',
        rlsCanary: !r.databaseOk ? 'unknown' : r.rlsCanaryOk ? 'ok' : 'failed',
        mail: this.mail.current(),
        version: this.version,
      };
    } catch {
      body = {
        status: 'unavailable',
        database: 'down',
        rlsCanary: 'unknown',
        mail: this.mail.current(),
        version: this.version,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
    this.cached = { at: now, body };
    return body;
  }
}
