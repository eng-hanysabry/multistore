/** Port (spec 9, 10.3). Business code only ever sees this, never Gmail. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
  /** Cheap credential check (token refresh, no mail). Used for the weekly no-op refresh. */
  checkAuth(): Promise<void>;
}
export const MAIL_SENDER = Symbol('MAIL_SENDER');

/** invalid_grant, revoked or 401 after refresh. Never retried; opens the circuit (9.1). */
export class MailPermanentAuthError extends Error {
  override readonly name = 'MailPermanentAuthError';
}
/** 429, 5xx, timeouts. Retried with backoff (10.7). */
export class MailTransientError extends Error {
  override readonly name = 'MailTransientError';
}
/** The 500 per day account limit. Sends pause until the next day. */
export class MailDailyLimitError extends Error {
  override readonly name = 'MailDailyLimitError';
}
