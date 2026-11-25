import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { MailMessage } from '../domain/mail-sender';
import { OutboxRow, OutboxStore } from '../domain/outbox';

interface ClaimedRow {
  id: string;
  to_address: string;
  subject: string;
  body_text: string;
  attempts: number;
}

export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly db: PrismaClient) {}

  async enqueue(message: MailMessage, now: Date): Promise<string> {
    const id = randomUUID();
    await this.db.emailOutbox.create({
      data: {
        id,
        toAddress: message.to,
        subject: message.subject,
        bodyText: message.text,
        status: 'PENDING',
        nextAttemptAt: now,
      },
    });
    return id;
  }

  async claim(now: Date, leaseMs: number, limit: number): Promise<OutboxRow[]> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const rows = await this.db.$queryRaw<ClaimedRow[]>`
      UPDATE email_outbox SET status = 'SENDING', lease_until = ${leaseUntil}, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM email_outbox
        WHERE (status = 'PENDING' AND next_attempt_at <= ${now})
           OR (status = 'SENDING' AND lease_until < ${now})
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, to_address, subject, body_text, attempts`;
    return rows.map((r) => ({
      id: r.id,
      attempts: Number(r.attempts),
      message: { to: r.to_address, subject: r.subject, text: r.body_text },
    }));
  }

  async markSent(id: string, now: Date): Promise<void> {
    await this.db.emailOutbox.update({
      where: { id },
      data: { status: 'SENT', sentAt: now, leaseUntil: null, bodyText: '', lastError: null },
    });
  }

  async markRetry(id: string, at: Date, error: string): Promise<void> {
    await this.db.emailOutbox.update({
      where: { id },
      data: { status: 'PENDING', nextAttemptAt: at, leaseUntil: null, lastError: error },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.emailOutbox.update({
      where: { id },
      data: { status: 'FAILED', leaseUntil: null, lastError: error },
    });
  }

  async release(id: string, at: Date, error: string): Promise<void> {
    await this.db.$executeRaw`
      UPDATE email_outbox SET status = 'PENDING', next_attempt_at = ${at}, lease_until = NULL,
        attempts = GREATEST(attempts - 1, 0), last_error = ${error}
      WHERE id = ${id}::uuid`;
  }
}
