import { AppRole } from '../../../common/tenancy/tenant-context';

/**
 * Signs the short-lived access JWT (section 9: 15 minutes). The token carries identity and
 * role only; the active tenant is resolved from the URL on every request (6.3, 6.7).
 */
export interface AccessTokenSigner {
  sign(userId: string, role: AppRole, sessionId: string): Promise<string>;
}
export const ACCESS_TOKEN_SIGNER = Symbol('ACCESS_TOKEN_SIGNER');
