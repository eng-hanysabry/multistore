import { JwtService } from '@nestjs/jwt';
import { AppRole } from '../../../common/tenancy/tenant-context';
import { AccessTokenSigner } from '../domain/access-token-signer';
import { ACCESS_TOKEN_SECONDS } from '../domain/auth-rules';

/** Section 9: short-lived JWT carrying identity and role only (never the tenant). */
export class JwtAccessTokenSigner implements AccessTokenSigner {
  private readonly jwt: JwtService;

  constructor(secret: string) {
    this.jwt = new JwtService({
      secret,
      signOptions: { expiresIn: ACCESS_TOKEN_SECONDS },
    });
  }

  sign(userId: string, role: AppRole): Promise<string> {
    return this.jwt.signAsync({ sub: userId, role });
  }
}
