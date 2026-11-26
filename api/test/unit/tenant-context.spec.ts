import {
  APP_ROLES,
  assertTenantContext,
  InvalidTenantContextError,
} from '../../src/modules/tenancy/domain/tenant-context';

const UUID_1 = '11111111-1111-4111-8111-111111111111';

describe('tenant context validation at the runner boundary (6.3.3)', () => {
  it('accepts every fixed role and a full context', () => {
    for (const role of APP_ROLES) {
      expect(
        assertTenantContext({
          role,
          tenantId: UUID_1,
          userId: UUID_1,
          tenantCode: 'alpha-shop',
          loginEmail: 'user@example.com',
          tokenHash: 'a'.repeat(64),
        }).role,
      ).toBe(role);
    }
  });
  it('accepts a role-only context', () => {
    expect(assertTenantContext({ role: 'GUEST' }).role).toBe('GUEST');
  });
  it('rejects anything else before any query runs', () => {
    const bad = [
      undefined,
      null,
      {},
      { role: 'ADMIN' },
      { role: 'guest' },
      { role: 'GUEST', tenantId: 'not-a-uuid' },
      { role: 'GUEST', userId: '1' },
      { role: 'GUEST', tenantCode: 'X' },
      { role: 'GUEST', tenantCode: 'a'.repeat(41) },
      { role: 'GUEST', loginEmail: 'not-an-email' },
      { role: 'GUEST', tokenHash: 'xyz' },
      { role: 'GUEST', tokenHash: 'a'.repeat(63) },
    ] as const;
    for (const ctx of bad) {
      expect(() => assertTenantContext(ctx as never)).toThrow(InvalidTenantContextError);
    }
  });
});
