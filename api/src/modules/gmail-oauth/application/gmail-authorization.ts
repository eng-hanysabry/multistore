import { createHash, randomBytes } from 'node:crypto';
import { LogPort } from '../../../common/ports/log-port';
import { CallbackOutcome, CallbackRejection, OAuthPort, TokenSink } from '../domain/oauth-ports';

export interface AuthorizationConfig {
  /** GMAIL_ALLOWED_ACCOUNT: the only accepted Google account, from server configuration (9.1.1 rule 1). */
  readonly allowedAccount: string;
  /** Pinned Google account `sub`, once recorded (rule 4). */
  readonly pinnedSub?: string;
  readonly redirectUri: string;
  readonly stateTtlMs?: number;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
/** Short hashed identifier for the audit log: never the address itself, never a token. */
export const hashAccount = (email: string): string =>
  sha256(email.trim().toLowerCase()).slice(0, 12);

interface Session {
  readonly verifier: string;
  readonly expires: number;
}

/**
 * One-time authorization flow for the dedicated Gmail account (spec 9.1.1). Not exposed on any
 * public route (rule 6): it is run by the operator script.
 */
export class GmailAuthorization {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly oauth: OAuthPort,
    private readonly sink: TokenSink,
    private readonly cfg: AuthorizationConfig,
    private readonly audit: LogPort,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Single-use random state and PKCE (rule 5). */
  begin(): { url: string; state: string } {
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.sessions.set(state, {
      verifier,
      expires: this.clock() + (this.cfg.stateTtlMs ?? 10 * 60_000),
    });
    return {
      state,
      url: this.oauth.buildAuthUrl({
        state,
        codeChallenge: challenge,
        redirectUri: this.cfg.redirectUri,
      }),
    };
  }

  async handleCallback(p: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
  }): Promise<CallbackOutcome> {
    const session = p.state ? this.sessions.get(p.state) : undefined;
    if (p.state) this.sessions.delete(p.state); // single use, even when the rest fails
    if (!session || session.expires < this.clock()) return this.reject('bad_state');
    if (p.error || !p.code) return this.reject('oauth_error');

    let tokens;
    try {
      tokens = await this.oauth.exchange({
        code: p.code,
        codeVerifier: session.verifier,
        redirectUri: this.cfg.redirectUri,
      });
    } catch {
      return this.reject('exchange_failed');
    }
    const toRevoke = tokens.refreshToken ?? tokens.accessToken;

    let identity;
    try {
      identity = await this.oauth.verifyIdentity(tokens);
    } catch {
      return this.rejectAndRevoke('identity_unverified', toRevoke);
    }
    if (!identity.emailVerified) {
      return this.rejectAndRevoke('identity_unverified', toRevoke, identity.email);
    }
    if (identity.email.trim().toLowerCase() !== this.cfg.allowedAccount.trim().toLowerCase()) {
      return this.rejectAndRevoke('account_mismatch', toRevoke, identity.email);
    }
    if (this.cfg.pinnedSub && identity.sub !== this.cfg.pinnedSub) {
      return this.rejectAndRevoke('sub_mismatch', toRevoke, identity.email);
    }
    if (!tokens.refreshToken) return this.reject('no_refresh_token', identity.email);

    await this.sink.store({ refreshToken: tokens.refreshToken, sub: identity.sub });
    this.audit.log('gmail authorization accepted', { account: hashAccount(identity.email) });
    return { ok: true, sub: identity.sub };
  }

  private reject(
    reason: CallbackRejection,
    email?: string,
  ): { ok: false; reason: CallbackRejection } {
    this.audit.warn('gmail authorization rejected', {
      reason,
      ...(email ? { account: hashAccount(email) } : {}),
    });
    return { ok: false, reason };
  }

  /** Rejected identity: nothing is stored and the token Google just issued is revoked (rule 3). */
  private async rejectAndRevoke(
    reason: CallbackRejection,
    token: string | undefined,
    email?: string,
  ): Promise<{ ok: false; reason: CallbackRejection }> {
    if (token) {
      try {
        await this.oauth.revoke(token);
      } catch {
        this.audit.error('gmail token revocation failed after rejection');
      }
    }
    return this.reject(reason, email);
  }
}
