import { AuthService, GENERIC_CODE_MESSAGE } from '../../src/modules/auth/application/auth-service';
import { AuthError } from '../../src/modules/auth/domain/auth-errors';
import {
  AuthCodeRecord,
  AuthStore,
  RefreshTokenRecord,
  SessionRecord,
  UserRecord,
} from '../../src/modules/auth/domain/auth-store';
import { CodePurpose } from '../../src/modules/auth/domain/auth-rules';
import { TxHandle } from '../../src/common/tenancy/tenant-transaction-runner';

type Mut<T> = { -readonly [K in keyof T]: T[K] };
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('test setup expected a value');
  return v;
};

const TX: TxHandle = {};
const runner = {
  run: <T>(_ctx: unknown, work: (tx: TxHandle) => Promise<T>): Promise<T> => work(TX),
};
const hasher = {
  hash: (p: string): Promise<string> => Promise.resolve(`h:${p}`),
  verify: (h: string, p: string): Promise<boolean> => Promise.resolve(h === `h:${p}`),
};
const signer = {
  sign: (sub: string, role: string): Promise<string> => Promise.resolve(`jwt:${sub}:${role}`),
};

class FakeStore implements AuthStore {
  users = new Map<string, UserRecord>();
  codes: Mut<AuthCodeRecord>[] = [];
  sessions = new Map<string, SessionRecord>();
  tokens = new Map<string, RefreshTokenRecord & { tokenHash: string }>();
  assumed: string[] = [];

  findUserByLoginEmail(_tx: TxHandle, email: string): Promise<UserRecord | null> {
    return Promise.resolve([...this.users.values()].find((u) => u.email === email) ?? null);
  }
  findUserById(_tx: TxHandle, id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }
  insertPendingUser(
    _tx: TxHandle,
    row: { id: string; email: string; passwordHash: string },
  ): Promise<void> {
    this.users.set(row.id, { ...row, status: 'PENDING_VERIFICATION' });
    return Promise.resolve();
  }
  insertAuthCode(
    _tx: TxHandle,
    row: { id: string; userId: string; purpose: CodePurpose; codeHash: string; expiresAt: Date },
  ): Promise<void> {
    this.codes.push({ ...row, attempts: 0, consumedAt: null, createdAt: this.now });
    return Promise.resolve();
  }
  latestAuthCode(
    _tx: TxHandle,
    userId: string,
    purpose: CodePurpose,
  ): Promise<Mut<AuthCodeRecord> | null> {
    const list = this.codes.filter((c) => c.userId === userId && c.purpose === purpose);
    return Promise.resolve(list[list.length - 1] ?? null);
  }
  countAuthCodesSince(
    _tx: TxHandle,
    userId: string,
    purpose: CodePurpose,
    since: Date,
  ): Promise<number> {
    return Promise.resolve(
      this.codes.filter((c) => c.userId === userId && c.purpose === purpose && c.createdAt >= since)
        .length,
    );
  }
  incrementCodeAttempts(_tx: TxHandle, codeId: string): Promise<void> {
    const c = this.codes.find((x) => x.id === codeId);
    if (c) c.attempts += 1;
    return Promise.resolve();
  }
  consumeAuthCode(_tx: TxHandle, codeId: string, at: Date): Promise<void> {
    const c = this.codes.find((x) => x.id === codeId);
    if (c) c.consumedAt = at;
    return Promise.resolve();
  }
  activateUser(_tx: TxHandle, email: string): Promise<void> {
    const u = [...this.users.values()].find((x) => x.email === email);
    if (u) this.users.set(u.id, { ...u, status: 'ACTIVE' });
    return Promise.resolve();
  }
  updatePasswordByEmail(_tx: TxHandle, email: string, passwordHash: string): Promise<void> {
    const u = [...this.users.values()].find((x) => x.email === email);
    if (u) this.users.set(u.id, { ...u, passwordHash });
    return Promise.resolve();
  }
  updatePasswordById(_tx: TxHandle, id: string, passwordHash: string): Promise<void> {
    const u = this.users.get(id);
    if (u) this.users.set(id, { ...u, passwordHash });
    return Promise.resolve();
  }
  insertSession(
    _tx: TxHandle,
    row: { id: string; userId: string; expiresAt: Date },
  ): Promise<string> {
    const text = row.expiresAt.toISOString();
    this.sessions.set(row.id, { id: row.id, userId: row.userId, expiresAt: text, revokedAt: null });
    return Promise.resolve(text);
  }
  findSession(_tx: TxHandle, id: string): Promise<SessionRecord | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }
  revokeSessionsForUser(_tx: TxHandle, userId: string, reason: string, at: Date): Promise<void> {
    for (const [id, s] of this.sessions) {
      if (s.userId === userId && s.revokedAt === null) {
        this.sessions.set(id, { ...s, revokedAt: at });
        (s as { reason?: string }).reason = reason;
        this.revokedWith = reason;
      }
    }
    return Promise.resolve();
  }
  revokeSession(_tx: TxHandle, sessionId: string, reason: string, at: Date): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s && s.revokedAt === null) {
      this.sessions.set(sessionId, { ...s, revokedAt: at });
      this.revokedWith = reason;
      this.revokedSessionId = sessionId;
    }
    return Promise.resolve();
  }
  revokedWith: string | null = null;
  revokedSessionId: string | null = null;
  insertRefreshToken(
    _tx: TxHandle,
    row: { id: string; sessionId: string; userId: string; tokenHash: string },
  ): Promise<void> {
    this.tokens.set(row.id, {
      ...row,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86400_000),
    });
    return Promise.resolve();
  }
  findRefreshTokenByHash(_tx: TxHandle, tokenHash: string): Promise<RefreshTokenRecord | null> {
    return Promise.resolve(
      [...this.tokens.values()].find((t) => t.tokenHash === tokenHash) ?? null,
    );
  }
  markTokenRotated(_tx: TxHandle, id: string, replacedById: string): Promise<void> {
    const t = this.tokens.get(id);
    if (t) this.tokens.set(id, { ...t, status: 'ROTATED', replacedById } as never);
    return Promise.resolve();
  }
  assumeUser(_tx: TxHandle, userId: string): Promise<void> {
    this.assumed.push(userId);
    return Promise.resolve();
  }

  constructor(public now: Date) {}
}

const make = (store: FakeStore, outbox: { queue: jest.Mock }, clock: () => Date): AuthService =>
  new AuthService(
    runner as never,
    store,
    hasher,
    signer,
    outbox as never,
    clock,
    (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    })(),
  );

/** Registers and returns the code the outbox captured. */
async function registerAndGetCode(
  svc: AuthService,
  outbox: { queue: jest.Mock },
  email = 'user@example.com',
): Promise<string> {
  await svc.register({ email, password: 'pw' });
  const text: string = outbox.queue.mock.calls[0]?.[0]?.text ?? '';
  return /code is (\d{6})/.exec(text)?.[1] ?? '';
}

let store: FakeStore;
let outbox: { queue: jest.Mock };
let now: Date;
let svc: AuthService;

beforeEach(() => {
  now = new Date('2026-11-26T12:00:00Z');
  store = new FakeStore(now);
  outbox = { queue: jest.fn().mockResolvedValue('outbox-id') };
  svc = make(store, outbox, () => now);
});

describe('register / resend (section 9, 8.6.8)', () => {
  it('creates a PENDING_VERIFICATION user and emails a hashed 6-digit code', async () => {
    const code = await registerAndGetCode(svc, outbox);
    expect(code).toMatch(/^\d{6}$/);
    const user = must([...store.users.values()][0]);
    expect(user.status).toBe('PENDING_VERIFICATION');
    const rec = must(store.codes[0]);
    expect(rec.codeHash).toBe(`h:${code}`);
    expect(rec.expiresAt.getTime() - now.getTime()).toBe(10 * 60_000);
  });
  it('duplicate registration returns the identical message and sends nothing', async () => {
    await registerAndGetCode(svc, outbox);
    outbox.queue.mockClear();
    const again = await svc.register({ email: 'user@example.com', password: 'other' });
    expect(again).toEqual({ message: GENERIC_CODE_MESSAGE });
    expect(outbox.queue).not.toHaveBeenCalled();
  });
  it('resend honors the 60-second cooldown and the daily cap', async () => {
    await registerAndGetCode(svc, outbox);
    await expect(svc.resendVerificationCode({ email: 'user@example.com' })).rejects.toThrow(
      new AuthError('RESEND_COOLDOWN'),
    );
    now = new Date(now.getTime() + 61_000);
    await svc.resendVerificationCode({ email: 'user@example.com' });
    expect(store.codes).toHaveLength(2);
    // daily cap: burn the remaining 8 without cooldown interference
    for (let i = 0; i < 8; i++) {
      now = new Date(now.getTime() + 61_000);
      await svc.resendVerificationCode({ email: 'user@example.com' });
    }
    now = new Date(now.getTime() + 61_000);
    await expect(svc.resendVerificationCode({ email: 'user@example.com' })).rejects.toThrow(
      new AuthError('DAILY_CODE_CAP'),
    );
    expect(store.codes).toHaveLength(10);
  });
  it('resend to an unknown address is generic and silent', async () => {
    await expect(svc.resendVerificationCode({ email: 'ghost@example.com' })).resolves.toEqual({
      message: GENERIC_CODE_MESSAGE,
    });
    expect(outbox.queue).not.toHaveBeenCalled();
  });
});

describe('verify email (section 9, STM-14)', () => {
  it('wrong code: attempts counted; correct code: ACTIVE and tokens issued', async () => {
    const code = await registerAndGetCode(svc, outbox);
    const wrong = code === '000000' ? '000001' : '000000';
    await expect(svc.verifyEmail({ email: 'user@example.com', code: wrong })).rejects.toThrow(
      new AuthError('CODE_INVALID'),
    );
    expect(must(store.codes[0]).attempts).toBe(1);
    const tokens = await svc.verifyEmail({ email: 'user@example.com', code });
    expect(must([...store.users.values()][0]).status).toBe('ACTIVE');
    expect(must(store.codes[0]).consumedAt).not.toBeNull();
    expect(tokens.accessToken).toMatch(/^jwt:.*:CUSTOMER$/);
    expect(tokens.accessTokenExpiresIn).toBe(900);
    expect(tokens.refreshToken).toBeTruthy();
    expect(store.sessions.size).toBe(1);
    expect(store.tokens.size).toBe(1);
  });
  it('expired codes and the 5-attempt limit hold', async () => {
    const code = await registerAndGetCode(svc, outbox);
    now = new Date(now.getTime() + 11 * 60_000);
    await expect(svc.verifyEmail({ email: 'user@example.com', code })).rejects.toThrow(
      new AuthError('CODE_EXPIRED'),
    );
    now = new Date('2026-11-26T12:00:00Z');
    must(store.codes[0]).attempts = 5;
    await expect(svc.verifyEmail({ email: 'user@example.com', code })).rejects.toThrow(
      new AuthError('CODE_TOO_MANY_ATTEMPTS'),
    );
    expect(must(store.codes[0]).consumedAt).toBeNull();
  });
});

describe('login (section 9)', () => {
  it('rejects wrong password, unknown email, disabled and unverified generically', async () => {
    const code = await registerAndGetCode(svc, outbox);
    await expect(svc.login({ email: 'user@example.com', password: 'wrong' })).rejects.toThrow(
      new AuthError('INVALID_CREDENTIALS'),
    );
    await expect(svc.login({ email: 'ghost@example.com', password: 'pw' })).rejects.toThrow(
      new AuthError('INVALID_CREDENTIALS'),
    );
    await expect(svc.login({ email: 'user@example.com', password: 'pw' })).rejects.toThrow(
      new AuthError('EMAIL_NOT_VERIFIED'),
    );
    await svc.verifyEmail({ email: 'user@example.com', code });
    const u = must([...store.users.values()][0]);
    store.users.set(u.id, { ...u, status: 'DISABLED' });
    await expect(svc.login({ email: 'user@example.com', password: 'pw' })).rejects.toThrow(
      new AuthError('INVALID_CREDENTIALS'),
    );
  });
  it('issues tokens for a verified account', async () => {
    const code = await registerAndGetCode(svc, outbox);
    await svc.verifyEmail({ email: 'user@example.com', code });
    const tokens = await svc.login({ email: 'user@example.com', password: 'pw' });
    expect(tokens.refreshToken).toBeTruthy();
    expect(store.sessions.size).toBe(2); // one from verify, one from login
  });
});

describe('refresh rotation and reuse detection (section 9, STM-12)', () => {
  it('rotates: successor first, old token ROTATED with replaced_by_id', async () => {
    const code = await registerAndGetCode(svc, outbox);
    const first = await svc.verifyEmail({ email: 'user@example.com', code });
    const second = await svc.refresh({ refreshToken: first.refreshToken });
    expect(second.refreshToken).not.toEqual(first.refreshToken);
    const old = must([...store.tokens.values()][0]);
    expect(old.status).toBe('ROTATED');
    expect((old as { replacedById?: string }).replacedById).toBeTruthy();
    expect(store.tokens.size).toBe(2);
  });
  it('a reused rotated token revokes only its own session (STM-12)', async () => {
    const code = await registerAndGetCode(svc, outbox);
    const first = await svc.verifyEmail({ email: 'user@example.com', code });
    const other = await svc.login({ email: 'user@example.com', password: 'pw' });
    await svc.refresh({ refreshToken: first.refreshToken });
    await expect(svc.refresh({ refreshToken: first.refreshToken })).rejects.toThrow(
      new AuthError('TOKEN_INVALID'),
    );
    expect(store.revokedWith).toBe('REUSE_DETECTED');
    const sessions = [...store.sessions.values()];
    expect(sessions.filter((s) => s.revokedAt !== null)).toHaveLength(1);
    // the second login's session is unaffected
    await expect(svc.refresh({ refreshToken: other.refreshToken })).resolves.toBeTruthy();
  });
  it('unknown or session-revoked tokens are invalid', async () => {
    await expect(svc.refresh({ refreshToken: 'nope' })).rejects.toThrow(
      new AuthError('TOKEN_INVALID'),
    );
    const code = await registerAndGetCode(svc, outbox);
    const first = await svc.verifyEmail({ email: 'user@example.com', code });
    await svc.logout({ refreshToken: first.refreshToken });
    await expect(svc.refresh({ refreshToken: first.refreshToken })).rejects.toThrow(
      new AuthError('TOKEN_INVALID'),
    );
  });
});

describe('logout and password flows (section 9)', () => {
  it('logout revokes the session and is idempotent for unknown tokens', async () => {
    const code = await registerAndGetCode(svc, outbox);
    const tokens = await svc.verifyEmail({ email: 'user@example.com', code });
    await svc.logout({ refreshToken: tokens.refreshToken });
    expect(store.revokedWith).toBe('LOGOUT');
    await expect(svc.logout({ refreshToken: 'unknown' })).resolves.toBeUndefined();
  });
  it('reset request is generic; confirm sets the new password and revokes sessions', async () => {
    const code = await registerAndGetCode(svc, outbox);
    await svc.verifyEmail({ email: 'user@example.com', code });
    await expect(svc.requestPasswordReset({ email: 'ghost@example.com' })).resolves.toEqual({
      message: GENERIC_CODE_MESSAGE,
    });
    await svc.requestPasswordReset({ email: 'user@example.com' });
    const text: string = outbox.queue.mock.calls[1]?.[0]?.text ?? '';
    const resetCode = /code is (\d{6})/.exec(text)?.[1] ?? '';
    await svc.confirmPasswordReset({
      email: 'user@example.com',
      code: resetCode,
      newPassword: 'new-pw',
    });
    const user = must([...store.users.values()][0]);
    expect(user.passwordHash).toBe('h:new-pw');
    expect(store.revokedWith).toBe('PASSWORD_CHANGED');
    await expect(
      svc.login({ email: 'user@example.com', password: 'new-pw' }),
    ).resolves.toBeTruthy();
  });
  it('changePassword verifies the current password and revokes sessions', async () => {
    const code = await registerAndGetCode(svc, outbox);
    await svc.verifyEmail({ email: 'user@example.com', code });
    const user = must([...store.users.values()][0]);
    await expect(
      svc.changePassword(
        { role: 'CUSTOMER', userId: user.id },
        { currentPassword: 'wrong', newPassword: 'new-pw' },
      ),
    ).rejects.toThrow(new AuthError('INVALID_CREDENTIALS'));
    await svc.changePassword(
      { role: 'CUSTOMER', userId: user.id },
      { currentPassword: 'pw', newPassword: 'new-pw' },
    );
    expect(store.users.get(user.id)?.passwordHash).toBe('h:new-pw');
    expect(store.revokedWith).toBe('PASSWORD_CHANGED');
  });
});
