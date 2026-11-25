export const GMAIL_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
];

export interface OAuthTokens {
  readonly refreshToken?: string;
  readonly accessToken?: string;
  readonly idToken?: string;
}

/** Identity read from the Google ID token or userinfo, never from a request value (9.1.1 rule 2). */
export interface VerifiedIdentity {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly sub: string;
}

export interface OAuthPort {
  buildAuthUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens>;
  verifyIdentity(tokens: OAuthTokens): Promise<VerifiedIdentity>;
  revoke(token: string): Promise<void>;
}

export interface TokenSink {
  store(t: { refreshToken: string; sub: string }): Promise<void>;
}

export type CallbackRejection =
  | 'bad_state'
  | 'oauth_error'
  | 'exchange_failed'
  | 'identity_unverified'
  | 'account_mismatch'
  | 'sub_mismatch'
  | 'no_refresh_token';

export type CallbackOutcome =
  | { readonly ok: true; readonly sub: string }
  | { readonly ok: false; readonly reason: CallbackRejection };
