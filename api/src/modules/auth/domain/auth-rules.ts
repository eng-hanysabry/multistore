/** Section 9 + approval of 26 Nov: fixed values for the authentication flows. */
export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;
/** The spec names a daily cap per address without a number; 10 keeps the 500/day Gmail quota safe. */
export const DAILY_CODE_CAP = 10;
export const SESSION_LIFETIME_DAYS = 30;
export const ACCESS_TOKEN_SECONDS = 15 * 60;

export type CodePurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export function codeExpiry(from: Date): Date {
  return new Date(from.getTime() + CODE_TTL_MINUTES * 60_000);
}

export function sessionExpiry(from: Date): Date {
  return new Date(from.getTime() + SESSION_LIFETIME_DAYS * 24 * 60 * 60_000);
}

export function startOfUtcDay(of: Date): Date {
  return new Date(Date.UTC(of.getUTCFullYear(), of.getUTCMonth(), of.getUTCDate()));
}
