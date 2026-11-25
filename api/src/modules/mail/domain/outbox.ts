import { MailMessage } from './mail-sender';

export interface OutboxRow {
  readonly id: string;
  readonly message: MailMessage;
  /** Attempts including the one just claimed. */
  readonly attempts: number;
}

/** Persistence port. Rows live in PostgreSQL, never only in memory (10.7). */
export interface OutboxStore {
  enqueue(message: MailMessage, now: Date): Promise<string>;
  /** Takes due PENDING rows and rows whose SENDING lease expired. Increments attempts. */
  claim(now: Date, leaseMs: number, limit: number): Promise<OutboxRow[]>;
  /** Clears the stored body once sent, so a code is not kept in plain text. */
  markSent(id: string, now: Date): Promise<void>;
  markRetry(id: string, at: Date, error: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Puts the row back without counting the attempt (auth failure, daily limit). */
  release(id: string, at: Date, error: string): Promise<void>;
}
export const OUTBOX_STORE = Symbol('OUTBOX_STORE');

export const BACKOFF_SECONDS: readonly number[] = [1, 5, 30, 120];
export const MAX_ATTEMPTS = 5;

/** Delay before the next try after attempt number `attempts` failed, or undefined when exhausted. */
export function retryDelayMs(attempts: number): number | undefined {
  if (attempts >= MAX_ATTEMPTS) return undefined;
  const s = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1];
  return s === undefined ? undefined : s * 1000;
}

/** Next UTC midnight plus one minute: when the daily sending limit has reset. */
export function nextDailyReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1));
}
