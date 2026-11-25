import {
  GmailAuthorization,
  hashAccount,
} from '../../src/modules/gmail-oauth/application/gmail-authorization';
import {
  OAuthPort,
  OAuthTokens,
  VerifiedIdentity,
} from '../../src/modules/gmail-oauth/domain/oauth-ports';

const ALLOWED = 'mailer@gmail.com';
const SECRET_REFRESH = 'REFRESH-TOKEN-VALUE-1234567890';

class FakeOAuth implements OAuthPort {
  identity: VerifiedIdentity = { email: ALLOWED, emailVerified: true, sub: 'sub-1' };
  tokens: OAuthTokens = { refreshToken: SECRET_REFRESH, accessToken: 'ACCESS', idToken: 'ID' };
  revoked: string[] = [];
  exchangeFails = false;
  lastChallenge = '';
  lastCode = '';
  buildAuthUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string {
    this.lastChallenge = p.codeChallenge;
    return `https://accounts.example/auth?state=${p.state}`;
  }
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens> {
    this.lastCode = p.code;
    return this.exchangeFails
      ? Promise.reject(new Error('bad code'))
      : Promise.resolve(this.tokens);
  }
  verifyIdentity(): Promise<VerifiedIdentity> {
    return Promise.resolve(this.identity);
  }
  revoke(t: string): Promise<void> {
    this.revoked.push(t);
    return Promise.resolve();
  }
}

function setup(pinnedSub?: string) {
  const oauth = new FakeOAuth();
  const stored: { refreshToken: string; sub: string }[] = [];
  const lines: string[] = [];
  const audit = {
    log: (m: string, c?: Record<string, unknown>) => lines.push(JSON.stringify({ m, c })),
    warn: (m: string, c?: Record<string, unknown>) => lines.push(JSON.stringify({ m, c })),
    error: (m: string) => lines.push(m),
  };
  let now = 1_000_000;
  const auth = new GmailAuthorization(
    oauth,
    { store: (t) => (stored.push(t), Promise.resolve()) },
    {
      allowedAccount: ALLOWED,
      ...(pinnedSub ? { pinnedSub } : {}),
      redirectUri: 'http://127.0.0.1:1/callback',
    },
    audit,
    () => now,
  );
  return { oauth, stored, lines, auth, advance: (ms: number) => (now += ms) };
}

describe('GmailAuthorization (spec 9.1.1)', () => {
  it('accepts the allowed account, stores the token, audits without secrets', async () => {
    const { auth, stored, lines } = setup();
    const { state } = auth.begin();
    expect(await auth.handleCallback({ code: 'c', state })).toEqual({ ok: true, sub: 'sub-1' });
    expect(stored).toEqual([{ refreshToken: SECRET_REFRESH, sub: 'sub-1' }]);
    const log = lines.join('\n');
    expect(log).toContain(hashAccount(ALLOWED));
    expect(log).not.toContain(SECRET_REFRESH);
    expect(log).not.toContain(ALLOWED);
  });

  it('matches the address case-insensitively', async () => {
    const { auth, oauth, stored } = setup();
    oauth.identity = { ...oauth.identity, email: 'Mailer@Gmail.com' };
    const { state } = auth.begin();
    expect((await auth.handleCallback({ code: 'c', state })).ok).toBe(true);
    expect(stored).toHaveLength(1);
  });

  it('a different Google account is rejected, nothing is stored, the token is revoked', async () => {
    const { auth, oauth, stored } = setup();
    oauth.identity = { email: 'someone.else@gmail.com', emailVerified: true, sub: 'sub-9' };
    const { state } = auth.begin();
    expect(await auth.handleCallback({ code: 'c', state })).toEqual({
      ok: false,
      reason: 'account_mismatch',
    });
    expect(stored).toEqual([]);
    expect(oauth.revoked).toEqual([SECRET_REFRESH]);
  });

  it('a look-alike address of the same person is rejected', async () => {
    const { auth, oauth, stored } = setup();
    oauth.identity = { email: 'mailer+x@gmail.com', emailVerified: true, sub: 'sub-1' };
    const { state } = auth.begin();
    expect((await auth.handleCallback({ code: 'c', state })).ok).toBe(false);
    expect(stored).toEqual([]);
  });

  it('an unverified email claim is rejected and revoked', async () => {
    const { auth, oauth, stored } = setup();
    oauth.identity = { ...oauth.identity, emailVerified: false };
    const { state } = auth.begin();
    expect(await auth.handleCallback({ code: 'c', state })).toEqual({
      ok: false,
      reason: 'identity_unverified',
    });
    expect(stored).toEqual([]);
    expect(oauth.revoked).toHaveLength(1);
  });

  it('a pinned sub must match as well as the email', async () => {
    const { auth, oauth, stored } = setup('sub-pinned');
    const { state } = auth.begin();
    expect(await auth.handleCallback({ code: 'c', state })).toEqual({
      ok: false,
      reason: 'sub_mismatch',
    });
    expect(stored).toEqual([]);
    expect(oauth.revoked).toHaveLength(1);
    oauth.identity = { ...oauth.identity, sub: 'sub-pinned' };
    const second = auth.begin();
    expect((await auth.handleCallback({ code: 'c', state: second.state })).ok).toBe(true);
  });

  it('rejects a missing, wrong, reused or expired state, and never exchanges the code', async () => {
    const { auth, oauth, stored, advance } = setup();
    const spy = jest.spyOn(oauth, 'exchange');
    expect(await auth.handleCallback({ code: 'c' })).toEqual({ ok: false, reason: 'bad_state' });
    expect(await auth.handleCallback({ code: 'c', state: 'forged' })).toEqual({
      ok: false,
      reason: 'bad_state',
    });
    const first = auth.begin();
    expect((await auth.handleCallback({ code: 'c', state: first.state })).ok).toBe(true);
    expect(await auth.handleCallback({ code: 'c', state: first.state })).toEqual({
      ok: false,
      reason: 'bad_state',
    });
    const old = auth.begin();
    advance(11 * 60_000);
    expect(await auth.handleCallback({ code: 'c', state: old.state })).toEqual({
      ok: false,
      reason: 'bad_state',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);
  });

  it('uses PKCE: the challenge is the S256 hash of a verifier that is sent only at exchange', async () => {
    const { auth, oauth } = setup();
    const spy = jest.spyOn(oauth, 'exchange');
    const { state } = auth.begin();
    expect(oauth.lastChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await auth.handleCallback({ code: 'c', state });
    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.codeVerifier.length).toBeGreaterThan(40);
  });

  it('handles denied consent, failed exchange and a missing refresh token', async () => {
    const { auth, oauth, stored } = setup();
    expect(
      await auth.handleCallback({ error: 'access_denied', state: auth.begin().state }),
    ).toEqual({ ok: false, reason: 'oauth_error' });
    oauth.exchangeFails = true;
    expect(await auth.handleCallback({ code: 'c', state: auth.begin().state })).toEqual({
      ok: false,
      reason: 'exchange_failed',
    });
    oauth.exchangeFails = false;
    oauth.tokens = { accessToken: 'A', idToken: 'I' };
    expect(await auth.handleCallback({ code: 'c', state: auth.begin().state })).toEqual({
      ok: false,
      reason: 'no_refresh_token',
    });
    expect(stored).toEqual([]);
  });
});
