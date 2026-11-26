import { VerifiedAccessToken } from './verified-token';

/**
 * What the security guards attach to the incoming request (spec 6.3: context comes only
 * from server-verified sources, never from body, query or header input beyond the Bearer
 * token itself and the URL tenant code).
 */
export interface RequestSecurity {
  /** Set by JwtAuthGuard on authenticated routes; absent on @Public() routes (GUEST). */
  auth?: VerifiedAccessToken;
  /** Set by TenantResolverGuard from the validated :tenantCode path parameter. */
  tenantId?: string;
  tenantCode?: string;
}
