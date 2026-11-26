import { JwtService } from '@nestjs/jwt';
import { AppRole, APP_ROLES } from '../../../common/tenancy/tenant-context';
import {
  AccessTokenVerifier,
  TokenVerificationError,
  VerifiedAccessToken,
} from '../../../common/auth/verified-token';
import { AccessTokenSigner } from '../domain/access-token-signer';
import { ACCESS_TOKEN_SECONDS, JWT_AUDIENCE, JWT_ISSUER } from '../domain/auth-rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AccessClaims {
  sub?: unknown;
  role?: unknown;
  sid?: unknown;
}

/**
 * Section 9 / STM-11: short-lived JWT carrying identity, role and session id only (never
 * the tenant). HS256 is pinned on both sign and verify; issuer, audience, expiry and the
 * required claims are validated on every verify. Rejections never reveal which check
 * failed to the caller — the single TokenVerificationError message is all they get.
 */
export class JwtAccessTokenSigner implements AccessTokenSigner, AccessTokenVerifier {
  private readonly jwt: JwtService;

  constructor(secret: string) {
    this.jwt = new JwtService({
      secret,
      signOptions: {
        expiresIn: ACCESS_TOKEN_SECONDS,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
      },
    });
  }

  sign(userId: string, role: AppRole, sessionId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, role, sid: sessionId });
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new TokenVerificationError('invalid');
    }
    if (
      typeof claims.sub !== 'string' ||
      !UUID.test(claims.sub) ||
      typeof claims.sid !== 'string' ||
      !UUID.test(claims.sid) ||
      typeof claims.role !== 'string' ||
      !(APP_ROLES as readonly string[]).includes(claims.role)
    ) {
      throw new TokenVerificationError('claims');
    }
    return { userId: claims.sub, role: claims.role as AppRole, sessionId: claims.sid };
  }
}
