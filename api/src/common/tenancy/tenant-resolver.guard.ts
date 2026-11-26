import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { toSafeError } from '../errors/safe-error';
import { RequestSecurity } from '../auth/request-security';
import { TENANT_RESOLVER, TenantResolver } from './tenant-resolver';
import { assertTenantContext } from './tenant-context';

interface HttpRequestLike {
  params: Record<string, unknown>;
}

const TENANT_CODE = /^[a-z0-9-]{3,40}$/;

/**
 * TenantResolverGuard (spec 6.3, 6.7): on routes with a :tenantCode path parameter the
 * tenant is resolved server-side and attached to the request; the value never comes from
 * body, query or headers. An unknown, malformed or suspended code is a 404 with no
 * detail. Routes without the parameter are not tenant routes and pass through.
 */
@Injectable()
export class TenantResolverGuard implements CanActivate {
  constructor(@Inject(TENANT_RESOLVER) private readonly resolver: TenantResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpRequestLike & RequestSecurity>();
    const code = req.params?.['tenantCode'];
    if (code === undefined) return true;
    if (typeof code !== 'string' || !TENANT_CODE.test(code)) {
      throw new NotFoundException(toSafeError('NOT_FOUND', 'Not found.'));
    }
    const resolved = await this.resolver.resolve(code);
    if (!resolved) {
      throw new NotFoundException(toSafeError('NOT_FOUND', 'Not found.'));
    }
    // Validated before it is attached: only well-formed context ever travels downstream.
    assertTenantContext({
      role: 'GUEST',
      tenantId: resolved.tenantId,
      tenantCode: resolved.tenantCode,
    });
    req.tenantId = resolved.tenantId;
    req.tenantCode = resolved.tenantCode;
    return true;
  }
}
