/**
 * Server-side tenant resolution (spec 6.3, 6.7): the tenant code from the URL path is
 * resolved against the tenants table by the server. Unknown, malformed or suspended codes
 * all resolve to null — the caller answers 404 with no detail.
 */
export interface ResolvedTenant {
  readonly tenantId: string;
  readonly tenantCode: string;
}

export interface TenantResolver {
  resolve(tenantCode: string): Promise<ResolvedTenant | null>;
}

export const TENANT_RESOLVER = Symbol('TENANT_RESOLVER');
