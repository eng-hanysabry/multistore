/**
 * Spec 6.3: context comes only from server-verified sources, never from request input.
 * The runner accepts this typed context; anything else fails before any query runs.
 */
export const APP_ROLES = ['GUEST', 'CUSTOMER', 'MERCHANT', 'SUPER_ADMIN'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface TenantContext {
  readonly role: AppRole;
  /** Validated tenant UUID (from the URL tenant code, resolved server-side). */
  readonly tenantId?: string;
  /** Authenticated user UUID from the verified JWT, or the token-resolved user in GUEST flows. */
  readonly userId?: string;
  /** Tenant code from the URL path (Guest tenant resolution). */
  readonly tenantCode?: string;
  /** Login/register identity in GUEST flows (server-validated input, lowercased). */
  readonly loginEmail?: string;
  /** SHA-256 hash of the presented refresh token (refresh/logout flows). */
  readonly tokenHash?: string;
}

export class InvalidTenantContextError extends Error {
  constructor(reason: string) {
    super(`invalid tenant context: ${reason}`);
    this.name = 'InvalidTenantContextError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_CODE = /^[a-z0-9-]{3,40}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const uuidField = (value: string | undefined, name: string): void => {
  if (value !== undefined && !UUID.test(value))
    throw new InvalidTenantContextError(`${name} must be a UUID`);
};

export function assertTenantContext(ctx: TenantContext): TenantContext {
  if (!ctx || typeof ctx !== 'object') throw new InvalidTenantContextError('context is required');
  if (!APP_ROLES.includes(ctx.role))
    throw new InvalidTenantContextError('role is not in the fixed set');
  uuidField(ctx.tenantId, 'tenantId');
  uuidField(ctx.userId, 'userId');
  if (ctx.tenantCode !== undefined && !TENANT_CODE.test(ctx.tenantCode))
    throw new InvalidTenantContextError('tenantCode shape');
  if (ctx.loginEmail !== undefined && !EMAIL.test(ctx.loginEmail))
    throw new InvalidTenantContextError('loginEmail shape');
  if (ctx.tokenHash !== undefined && !/^[0-9a-f]{64}$/.test(ctx.tokenHash))
    throw new InvalidTenantContextError('tokenHash must be a hex SHA-256');
  return ctx;
}
