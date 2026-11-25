import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { GMAIL_SCOPES, OAuthPort, OAuthTokens, VerifiedIdentity } from '../domain/oauth-ports';

export class GoogleOAuthAdapter implements OAuthPort {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private client(redirectUri?: string) {
    return new OAuth2Client(this.clientId, this.clientSecret, redirectUri);
  }

  buildAuthUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string {
    return this.client(p.redirectUri).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...GMAIL_SCOPES],
      state: p.state,
      code_challenge: p.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }

  async exchange(p: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<OAuthTokens> {
    const { tokens } = await this.client(p.redirectUri).getToken({
      code: p.code,
      codeVerifier: p.codeVerifier,
      redirect_uri: p.redirectUri,
    });
    return {
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
      ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
    };
  }

  async verifyIdentity(tokens: OAuthTokens): Promise<VerifiedIdentity> {
    if (!tokens.idToken) throw new Error('no id token');
    const ticket = await this.client().verifyIdToken({
      idToken: tokens.idToken,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) throw new Error('id token lacks identity');
    return {
      email: payload.email,
      emailVerified: payload.email_verified === true,
      sub: payload.sub,
    };
  }

  async revoke(token: string): Promise<void> {
    await this.client().revokeToken(token);
  }
}
