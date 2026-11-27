import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { toSafeError } from '../errors/safe-error';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ACCESS_TOKEN_VERIFIER, AccessTokenVerifier } from './verified-token';
import { RequestSecurity } from './request-security';

interface HttpRequestLike {
  headers: Record<string, unknown>;
}

/**
 * Hand-rolled JWT guard (no passport, per the approved dependency list). On @Public()
 * routes a request without a token stays unauthenticated and the server treats it as
 * GUEST; a @Public() request that DOES carry a Bearer token must still verify — an
 * invalid or expired token is a 401, never a silent downgrade to Guest (IP-5 Step 4).
 * On every other route a Bearer token must verify — signature, pinned algorithm, issuer,
 * audience, expiry and claims (STM-11). The failure response never says which check failed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<HttpRequestLike & RequestSecurity>();

    const header = req.headers['authorization'];
    const raw =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : '';
    if (isPublic) {
      if (!raw) return true; // anonymous Guest (6.3)
      try {
        req.auth = await this.verifier.verify(raw);
      } catch {
        throw new UnauthorizedException(toSafeError('UNAUTHENTICATED', 'Authentication required.'));
      }
      return true;
    }

    if (!raw) {
      throw new UnauthorizedException(toSafeError('UNAUTHENTICATED', 'Authentication required.'));
    }
    try {
      req.auth = await this.verifier.verify(raw);
    } catch {
      throw new UnauthorizedException(toSafeError('UNAUTHENTICATED', 'Authentication required.'));
    }
    return true;
  }
}
