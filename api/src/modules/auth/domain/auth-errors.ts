export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'CODE_TOO_MANY_ATTEMPTS'
  | 'RESEND_COOLDOWN'
  | 'DAILY_CODE_CAP'
  | 'TOKEN_INVALID';

/**
 * Codes the API may return. Account-enumeration rule (8.6.8): register, resend and
 * reset-request never fail on unknown addresses; login failures are always
 * INVALID_CREDENTIALS whether the address, the password or the account state was wrong
 * (the single documented exception is EMAIL_NOT_VERIFIED, mandated by section 9).
 */
export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}
