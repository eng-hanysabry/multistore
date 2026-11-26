import { AppRole } from '../tenancy/tenant-context';

/**
 * Claims of a verified access token (spec 9 + 6.7: identity and role only, never the
 * tenant; the session id ties the token to its session row).
 */
export interface VerifiedAccessToken {
  readonly userId: string;
  readonly role: AppRole;
  readonly sessionId: string;
}

/**
 * Verification port used by the guards. Implementations must pin the algorithm and
 * validate signature, issuer, audience, expiry and required claims on every call
 * (spec: JWT attack mitigations, STM-11). Rejections never say which check failed.
 */
export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export class TokenVerificationError extends Error {
  constructor(readonly reason: string) {
    super(`access token rejected: ${reason}`);
    this.name = 'TokenVerificationError';
  }
}
