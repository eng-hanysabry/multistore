import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { toSafeError } from '../errors/safe-error';
import { AppRole } from '../tenancy/tenant-context';
import { ROLES_KEY } from './roles.decorator';
import { RequestSecurity } from './request-security';

/**
 * Role check against the VERIFIED token claims attached by JwtAuthGuard (never request
 * input). Endpoints without @Roles metadata only require authentication. Membership in a
 * tenant for MERCHANT work is enforced separately by MerchantMembershipGuard (6.7).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<RequestSecurity>();
    if (!req.auth || !required.includes(req.auth.role)) {
      throw new ForbiddenException(toSafeError('FORBIDDEN', 'This role cannot use this endpoint.'));
    }
    return true;
  }
}
