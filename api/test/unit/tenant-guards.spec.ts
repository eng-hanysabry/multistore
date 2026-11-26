import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { TenantResolverGuard } from '../../src/common/tenancy/tenant-resolver.guard';
import { MerchantMembershipGuard } from '../../src/common/tenancy/merchant-membership.guard';
import { RequestSecurity } from '../../src/common/auth/request-security';
import { ResolvedTenant } from '../../src/common/tenancy/tenant-resolver';

const TENANT = '11111111-1111-4111-8111-111111111111';

type Req = RequestSecurity & { params: Record<string, unknown> };
const ctx = (req: Req): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const notFound = async (p: Promise<boolean>): Promise<NotFoundException> => {
  const err: unknown = await p.catch((e: NotFoundException) => e);
  expect(err).toBeInstanceOf(NotFoundException);
  const body = (err as NotFoundException).getResponse() as { code: string; message: string };
  // no detail: nothing about tenants, codes or status leaks (6.7, 8.6.1)
  expect(body.code).toBe('NOT_FOUND');
  expect(body.message).not.toMatch(/tenant|code|suspend|active|member/i);
  return err as NotFoundException;
};

describe('TenantResolverGuard (6.3, 6.7: tenant only from the URL, validated server-side)', () => {
  const resolverWith = (value: ResolvedTenant | null) => ({
    resolve: jest.fn().mockResolvedValue(value),
  });

  it('routes without :tenantCode pass through untouched', async () => {
    const resolver = resolverWith(null);
    const req: Req = { params: {} };
    await expect(new TenantResolverGuard(resolver).canActivate(ctx(req))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(req.tenantId).toBeUndefined();
  });

  it('resolves a valid code and attaches the validated tenant', async () => {
    const resolver = resolverWith({ tenantId: TENANT, tenantCode: 'demo-store' });
    const req: Req = { params: { tenantCode: 'demo-store' } };
    await expect(new TenantResolverGuard(resolver).canActivate(ctx(req))).resolves.toBe(true);
    expect(req.tenantId).toBe(TENANT);
    expect(req.tenantCode).toBe('demo-store');
  });

  it('malformed, unknown and suspended codes are a 404 with no detail', async () => {
    const resolver = resolverWith(null);
    for (const tenantCode of ['X', 'ab', 'UPPER', 'has space', 'a'.repeat(41), 'no-such-store']) {
      await notFound(
        new TenantResolverGuard(resolver).canActivate(ctx({ params: { tenantCode } })),
      );
    }
    // malformed codes never reach the resolver; only 'no-such-store' is well-formed
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith('no-such-store');
  });
});

describe('MerchantMembershipGuard (6.3 rule 2, 6.7: membership re-checked in the app layer)', () => {
  const checkerWith = (role: string | null) => ({
    membershipRole: jest.fn().mockResolvedValue(role),
  });
  const merchant = {
    userId: '33333333-3333-4333-8333-333333333333',
    role: 'MERCHANT' as const,
    sessionId: '44444444-4444-4444-8444-444444444444',
  };

  it('non-merchant roles and non-tenant routes pass without a check', async () => {
    const checker = checkerWith(null);
    const guard = new MerchantMembershipGuard(checker);
    await expect(guard.canActivate(ctx({ params: {}, tenantId: TENANT }))).resolves.toBe(true);
    await expect(
      guard.canActivate(
        ctx({ params: {}, auth: { ...merchant, role: 'CUSTOMER' }, tenantId: TENANT }),
      ),
    ).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ params: {}, auth: merchant }))).resolves.toBe(true);
    expect(checker.membershipRole).not.toHaveBeenCalled();
  });

  it('a merchant with a membership passes', async () => {
    const guard = new MerchantMembershipGuard(checkerWith('MERCHANT'));
    await expect(
      guard.canActivate(ctx({ params: {}, auth: merchant, tenantId: TENANT })),
    ).resolves.toBe(true);
  });

  it('a merchant without a membership gets a 404, not a 403 (8.3)', async () => {
    const guard = new MerchantMembershipGuard(checkerWith(null));
    const err = await notFound(
      guard.canActivate(ctx({ params: {}, auth: merchant, tenantId: TENANT })),
    );
    expect(err.getStatus()).toBe(404);
  });
});
