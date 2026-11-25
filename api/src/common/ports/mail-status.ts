export type MailStatusValue = 'OK' | 'DEGRADED';
export type MailDegradedReason = 'not_configured' | 'auth_failed' | 'daily_limit' | 'send_failing';

export interface MailStatus {
  readonly status: MailStatusValue;
  readonly reason?: MailDegradedReason;
}

/** Read by /health/ready. Implementations must never call Gmail (10.7). */
export interface MailStatusProvider {
  current(): MailStatus;
}
export const MAIL_STATUS = Symbol('MAIL_STATUS');
