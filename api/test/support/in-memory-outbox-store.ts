import { randomUUID } from 'node:crypto';
import { MailMessage } from '../../src/modules/mail/domain/mail-sender';
import { OutboxRow, OutboxStore } from '../../src/modules/mail/domain/outbox';

export interface MemRow {
  id: string;
  message: MailMessage;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  lastError?: string;
}

export class InMemoryOutboxStore implements OutboxStore {
  readonly rows = new Map<string, MemRow>();

  enqueue(message: MailMessage, now: Date): Promise<string> {
    const id = randomUUID();
    this.rows.set(id, { id, message, status: 'PENDING', attempts: 0, nextAttemptAt: now });
    return Promise.resolve(id);
  }
  claim(now: Date, leaseMs: number, limit: number): Promise<OutboxRow[]> {
    const due = [...this.rows.values()]
      .filter(
        (r) =>
          (r.status === 'PENDING' && r.nextAttemptAt <= now) ||
          (r.status === 'SENDING' && (r.leaseUntil ?? now) < now),
      )
      .slice(0, limit);
    for (const r of due) {
      r.status = 'SENDING';
      r.attempts += 1;
      r.leaseUntil = new Date(now.getTime() + leaseMs);
    }
    return Promise.resolve(
      due.map((r) => ({ id: r.id, message: r.message, attempts: r.attempts })),
    );
  }
  markSent(id: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { status: 'SENT', message: { ...r.message, text: '' } });
    return Promise.resolve();
  }
  markRetry(id: string, at: Date, error: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { status: 'PENDING', nextAttemptAt: at, lastError: error });
    return Promise.resolve();
  }
  markFailed(id: string, error: string): Promise<void> {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { status: 'FAILED', lastError: error });
    return Promise.resolve();
  }
  release(id: string, at: Date, error: string): Promise<void> {
    const r = this.rows.get(id);
    if (r)
      Object.assign(r, {
        status: 'PENDING',
        nextAttemptAt: at,
        lastError: error,
        attempts: Math.max(r.attempts - 1, 0),
      });
    return Promise.resolve();
  }
}
