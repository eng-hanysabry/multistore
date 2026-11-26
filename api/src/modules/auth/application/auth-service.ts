import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  TenantTransactionRunner,
  TxHandle,
} from '../../../common/tenancy/tenant-transaction-runner';
import { TenantContext } from '../../../common/tenancy/tenant-context';
import { AccessTokenSigner } from '../domain/access-token-signer';
import { AuthError } from '../domain/auth-errors';
import { AuthStore, UserRecord } from '../domain/auth-store';
import {
  ACCESS_TOKEN_SECONDS,
  codeExpiry,
  refreshExpiry,
  CodePurpose,
  DAILY_CODE_CAP,
  MAX_CODE_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  sessionExpiry,
  startOfUtcDay,
} from '../domain/auth-rules';
import { SecretHasher } from '../domain/password-hasher';

/**
 * The one thing auth needs from mail: queue a message (spec 10.3, outbox first). The mail
 * module's OutboxService structurally satisfies this port; composition wiring passes it in,
 * so the modules never import each other (5.3).
 */
export interface CodeMailQueue {
  queue(message: { to: string; subject: string; text: string }): Promise<string>;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresIn: number;
  readonly refreshToken: string;
}

/** 8.6.8: the one response shape for register, resend and reset request. */
export const GENERIC_CODE_MESSAGE =
  'If this address can use this flow, a code has been sent to it.';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Dummy verify on unknown users, so login timing does not leak account existence (8.6.8). */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class AuthService {
  constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly store: AuthStore,
    private readonly hasher: SecretHasher,
    private readonly signer: AccessTokenSigner,
    private readonly outbox: CodeMailQueue,
    private readonly clock: () => Date = () => new Date(),
    private readonly ids: () => string = () => randomUUID(),
  ) {}

  /** Register: PENDING_VERIFICATION + 6-digit code by email. Response is always generic. */
  async register(input: { email: string; password: string }): Promise<{ message: string }> {
    const email = input.email.toLowerCase();
    const ctx: TenantContext = { role: 'GUEST', loginEmail: email };
    const passwordHash = await this.hasher.hash(input.password);
    await this.runner.run(ctx, async (tx) => {
      const existing = await this.store.findUserByLoginEmail(tx, email);
      if (existing) return; // duplicate: same outward response, no code burned (8.6.8)
      const userId = this.ids();
      await this.store.insertPendingUser(tx, { id: userId, email, passwordHash });
      await this.issueCode(tx, { id: userId, email }, 'VERIFY_EMAIL');
    });
    return { message: GENERIC_CODE_MESSAGE };
  }

  /** Resend the verification code. Response is always generic. */
  async resendVerificationCode(input: { email: string }): Promise<{ message: string }> {
    const email = input.email.toLowerCase();
    await this.runner.run({ role: 'GUEST', loginEmail: email }, async (tx) => {
      const user = await this.store.findUserByLoginEmail(tx, email);
      if (!user || user.status !== 'PENDING_VERIFICATION') return;
      await this.issueCode(tx, user, 'VERIFY_EMAIL');
    });
    return { message: GENERIC_CODE_MESSAGE };
  }

  /**
   * Verify the email code. On success the account becomes ACTIVE and tokens are issued
   * (section 9). The code is consumed in the same transaction, which is what the
   * sensitive-field trigger requires before the status may change.
   */
  async verifyEmail(input: { email: string; code: string }): Promise<AuthTokens> {
    const email = input.email.toLowerCase();
    return this.runner.run({ role: 'GUEST', loginEmail: email }, async (tx) => {
      const user = await this.store.findUserByLoginEmail(tx, email);
      if (!user) throw new AuthError('CODE_INVALID');
      await this.checkCode(tx, user, 'VERIFY_EMAIL', input.code, this.clock());
      await this.store.activateUser(tx, email, this.clock());
      return this.issueSession(tx, user);
    });
  }

  /** Login: verified accounts only (section 9). Failures are generic. */
  async login(input: { email: string; password: string }): Promise<AuthTokens> {
    const email = input.email.toLowerCase();
    return this.runner.run({ role: 'GUEST', loginEmail: email }, async (tx) => {
      const user = await this.store.findUserByLoginEmail(tx, email);
      const ok = await this.hasher.verify(user?.passwordHash ?? DUMMY_HASH, input.password);
      if (!user || !ok || user.status === 'DISABLED') throw new AuthError('INVALID_CREDENTIALS');
      if (user.status === 'PENDING_VERIFICATION') throw new AuthError('EMAIL_NOT_VERIFIED');
      return this.issueSession(tx, user);
    });
  }

  /**
   * Refresh with rotation and reuse detection (section 9): a reused (already ROTATED)
   * token revokes the whole session. Successor token first, then replaced_by_id (FK order).
   */
  async refresh(input: { refreshToken: string }): Promise<AuthTokens> {
    const tokenHash = sha256(input.refreshToken);
    // A detected reuse must COMMIT the session revocation, so it cannot throw inside the
    // transaction (a throw rolls back). It returns a marker and throws after commit instead.
    const outcome = await this.runner.run({ role: 'GUEST', tokenHash }, async (tx) => {
      const token = await this.store.findRefreshTokenByHash(tx, tokenHash);
      if (!token) throw new AuthError('TOKEN_INVALID');
      await this.store.assumeUser(tx, token.userId);
      if (token.status === 'ROTATED') {
        // STM-12 / design doc section 8: reuse kills the compromised session only.
        await this.store.revokeSession(tx, token.sessionId, 'REUSE_DETECTED', this.clock());
        return { reused: true as const };
      }
      const now = this.clock();
      if (token.status !== 'ACTIVE' || token.expiresAt <= now) throw new AuthError('TOKEN_INVALID');
      const session = await this.store.findSession(tx, token.sessionId);
      if (!session || session.revokedAt !== null || new Date(session.expiresAt) <= now)
        throw new AuthError('TOKEN_INVALID');
      const successor: string = this.ids();
      const newRaw = randomUUID();
      await this.store.insertRefreshToken(tx, {
        id: successor,
        sessionId: token.sessionId,
        userId: token.userId,
        tokenHash: sha256(newRaw),
        expiresAt: refreshExpiry(now).toISOString(),
        sessionExpiresAt: session.expiresAt,
      });
      await this.store.markTokenRotated(tx, token.id, successor);
      return {
        tokens: {
          accessToken: await this.signer.sign(token.userId, 'CUSTOMER', token.sessionId),
          accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
          refreshToken: newRaw,
        },
      };
    });
    if ('reused' in outcome) throw new AuthError('TOKEN_INVALID');
    return outcome.tokens;
  }

  /** Logout: revoke the session behind the presented refresh token. Always succeeds. */
  async logout(input: { refreshToken: string }): Promise<void> {
    const tokenHash = sha256(input.refreshToken);
    await this.runner.run({ role: 'GUEST', tokenHash }, async (tx) => {
      const token = await this.store.findRefreshTokenByHash(tx, tokenHash);
      if (!token) return;
      await this.store.assumeUser(tx, token.userId);
      await this.store.revokeSession(tx, token.sessionId, 'LOGOUT', this.clock());
    });
  }

  /** Password reset request. Response is always generic. */
  async requestPasswordReset(input: { email: string }): Promise<{ message: string }> {
    const email = input.email.toLowerCase();
    await this.runner.run({ role: 'GUEST', loginEmail: email }, async (tx) => {
      const user = await this.store.findUserByLoginEmail(tx, email);
      if (!user || user.status !== 'ACTIVE') return;
      await this.issueCode(tx, user, 'RESET_PASSWORD');
    });
    return { message: GENERIC_CODE_MESSAGE };
  }

  /** Confirm a reset: consume the code, set the new password, revoke every session. */
  async confirmPasswordReset(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void> {
    const email = input.email.toLowerCase();
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.runner.run({ role: 'GUEST', loginEmail: email }, async (tx) => {
      const user = await this.store.findUserByLoginEmail(tx, email);
      if (!user) throw new AuthError('CODE_INVALID');
      await this.checkCode(tx, user, 'RESET_PASSWORD', input.code, this.clock());
      await this.store.updatePasswordByEmail(tx, email, passwordHash, this.clock());
      await this.store.assumeUser(tx, user.id);
      await this.store.revokeSessionsForUser(tx, user.id, 'PASSWORD_CHANGED', this.clock());
    });
  }

  /** Authenticated password change: verify the current one, then revoke every session. */
  async changePassword(
    ctx: TenantContext,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    if (!ctx.userId) throw new AuthError('INVALID_CREDENTIALS');
    const userId = ctx.userId;
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.runner.run({ role: ctx.role, tenantId: ctx.tenantId, userId }, async (tx) => {
      const user = await this.store.findUserById(tx, userId);
      if (!user) throw new AuthError('INVALID_CREDENTIALS');
      if (!(await this.hasher.verify(user.passwordHash, input.currentPassword)))
        throw new AuthError('INVALID_CREDENTIALS');
      await this.store.updatePasswordById(tx, userId, passwordHash, this.clock());
      await this.store.revokeSessionsForUser(tx, userId, 'PASSWORD_CHANGED', this.clock());
    });
  }

  // --- internals ---

  /** Cooldown + daily cap + insert + queue the email. Runs inside the caller's transaction. */
  private async issueCode(
    tx: TxHandle,
    user: Pick<UserRecord, 'id' | 'email'>,
    purpose: CodePurpose,
  ): Promise<void> {
    const now = this.clock();
    const latest = await this.store.latestAuthCode(tx, user.id, purpose);
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1_000)
      throw new AuthError('RESEND_COOLDOWN');
    const today = await this.store.countAuthCodesSince(tx, user.id, purpose, startOfUtcDay(now));
    if (today >= DAILY_CODE_CAP) throw new AuthError('DAILY_CODE_CAP');
    const code = newCode();
    await this.store.insertAuthCode(tx, {
      id: this.ids(),
      userId: user.id,
      purpose,
      codeHash: await this.hasher.hash(code),
      expiresAt: codeExpiry(now),
    });
    await this.outbox.queue({
      to: user.email,
      subject:
        purpose === 'VERIFY_EMAIL'
          ? 'Your MultiStore verification code'
          : 'Your MultiStore reset code',
      text: `Your code is ${code}. It expires in 10 minutes.`,
    });
  }

  private async checkCode(
    tx: TxHandle,
    user: UserRecord,
    purpose: CodePurpose,
    code: string,
    now: Date,
  ): Promise<void> {
    const record = await this.store.latestAuthCode(tx, user.id, purpose);
    if (!record || record.consumedAt !== null) throw new AuthError('CODE_INVALID');
    if (record.expiresAt <= now) throw new AuthError('CODE_EXPIRED');
    if (record.attempts >= MAX_CODE_ATTEMPTS) throw new AuthError('CODE_TOO_MANY_ATTEMPTS');
    if (!(await this.hasher.verify(record.codeHash, code))) {
      await this.store.incrementCodeAttempts(tx, record.id);
      throw new AuthError('CODE_INVALID');
    }
    await this.store.consumeAuthCode(tx, record.id, now);
  }

  private async issueSession(tx: TxHandle, user: UserRecord): Promise<AuthTokens> {
    const now = this.clock();
    const sessionId = this.ids();
    const expiresAtText = await this.store.insertSession(tx, {
      id: sessionId,
      userId: user.id,
      expiresAt: sessionExpiry(now),
    });
    const rawRefresh = randomUUID();
    await this.store.insertRefreshToken(tx, {
      id: this.ids(),
      sessionId,
      userId: user.id,
      tokenHash: sha256(rawRefresh),
      expiresAt: refreshExpiry(now).toISOString(),
      sessionExpiresAt: expiresAtText,
    });
    return {
      accessToken: await this.signer.sign(user.id, 'CUSTOMER', sessionId),
      accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
      refreshToken: rawRefresh,
    };
  }
}
