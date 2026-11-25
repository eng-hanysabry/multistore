import {
  MailDailyLimitError,
  MailMessage,
  MailPermanentAuthError,
  MailSender,
  MailTransientError,
} from '../domain/mail-sender';
import { buildRawMessage } from './rfc822';

/** The two Gmail calls we need. The real one wraps googleapis; tests inject a fake. */
export interface GmailTransport {
  sendRaw(raw: string): Promise<void>;
  /** Forces a refresh-token exchange. No mail is sent. */
  refreshAccessToken(): Promise<void>;
}

interface ErrorShape {
  code?: number | string;
  status?: number;
  message?: string;
  response?: { status?: number; data?: { error?: unknown; error_description?: string } };
}

/** Maps a Google client error to the three outcomes the outbox understands (9.1, 10.7). */
export function classifyGoogleError(err: unknown): Error {
  const e = (err ?? {}) as ErrorShape;
  const status =
    e.response?.status ?? e.status ?? (typeof e.code === 'number' ? e.code : undefined);
  const data = JSON.stringify(e.response?.data ?? {}).toLowerCase();
  const message = (e.message ?? '').toLowerCase();
  if (data.includes('invalid_grant') || message.includes('invalid_grant') || status === 401) {
    return new MailPermanentAuthError('gmail credentials rejected');
  }
  if (
    data.includes('dailylimit') ||
    data.includes('daily user sending') ||
    message.includes('daily')
  ) {
    return new MailDailyLimitError('gmail daily sending limit reached');
  }
  return new MailTransientError(status ? `gmail error ${status}` : 'gmail network error');
}

/** Sends through the Gmail API over HTTPS (Render Free blocks SMTP, 10.3). */
export class GmailApiMailSender implements MailSender {
  constructor(
    private readonly transport: GmailTransport,
    private readonly fromAddress: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const raw = buildRawMessage(this.fromAddress, message);
    try {
      await this.transport.sendRaw(raw);
    } catch (err) {
      throw classifyGoogleError(err);
    }
  }

  async checkAuth(): Promise<void> {
    try {
      await this.transport.refreshAccessToken();
    } catch (err) {
      throw classifyGoogleError(err);
    }
  }
}
