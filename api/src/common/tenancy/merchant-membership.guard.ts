import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { toSafeError } from '../errors/safe-error';
import { RequestSecurity } from '../auth/request-security';
import { MEMBERSHIP_CHECKER, MembershipChecker } from './membership-checker';

/**
 * MerchantMembershipGuard (spec 6.3 rule 2, 6.7): when a request carries a verified
 * MERCHANT token on a tenant route, the memberships table must contain (user, tenant,
 * role); a forged or stale role claim never passes. No membership: 404, consistent with
 * 8.3 — the store's existence is not revealed. Other roles and non-tenant routes pass;
 * RLS still enforces the tenant boundary underneath.
 */
@Injectable()
export class MerchantMembershipGuard implements CanActivate {
  constructor(@Inject(MEMBERSHIP_CHECKER) private readonly checker: MembershipChecker) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestSecurity>();
    if (req.auth?.role !== 'MERCHANT' || req.tenantId === undefined) return true;
    const role = await this.checker.membershipRole(req.auth.userId, req.tenantId);
    if (role === null) {
      throw new NotFoundException(toSafeError('NOT_FOUND', 'Not found.'));
    }
    return true;
  }
}
