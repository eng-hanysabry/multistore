import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { CodePurpose } from './auth-rules';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'DISABLED';
}

export interface AuthCodeRecord {
  readonly id: string;
  readonly userId: string;
  readonly purpose: CodePurpose;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  /** As read from the row, exact text form: pass it back unchanged (sub-ms precision). */
  readonly expiresAt: string;
  readonly revokedAt: Date | null;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly status: 'ACTIVE' | 'ROTATED' | 'REVOKED';
  readonly expiresAt: Date;
}

/**
 * Persistence port for the auth flows. Every method runs inside the caller's transaction
 * (the runner's TxHandle) so the RLS context and the queries share one connection (6.3).
 * The RLS policies are the real authorization boundary; these queries only shape data.
 */
export interface AuthStore {
  /** GUEST login lookup (app.login_email must be set in the context). */
  findUserByLoginEmail(tx: TxHandle, email: string): Promise<UserRecord | null>;
  /** Self read (app.user_id must be set in the context). */
  findUserById(tx: TxHandle, id: string): Promise<UserRecord | null>;
  insertPendingUser(
    tx: TxHandle,
    row: { id: string; email: string; passwordHash: string },
  ): Promise<void>;
  insertAuthCode(
    tx: TxHandle,
    row: { id: string; userId: string; purpose: CodePurpose; codeHash: string; expiresAt: Date },
  ): Promise<void>;
  latestAuthCode(
    tx: TxHandle,
    userId: string,
    purpose: CodePurpose,
  ): Promise<AuthCodeRecord | null>;
  countAuthCodesSince(
    tx: TxHandle,
    userId: string,
    purpose: CodePurpose,
    since: Date,
  ): Promise<number>;
  incrementCodeAttempts(tx: TxHandle, codeId: string): Promise<void>;
  consumeAuthCode(tx: TxHandle, codeId: string, at: Date): Promise<void>;
  /** PENDING_VERIFICATION -> ACTIVE with email_verified_at; the trigger demands a consumed code. */
  activateUser(tx: TxHandle, email: string, at: Date): Promise<void>;
  updatePasswordByEmail(
    tx: TxHandle,
    email: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void>;
  updatePasswordById(
    tx: TxHandle,
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void>;
  /** Returns expires_at in exact text form for the refresh-token row that follows. */
  insertSession(
    tx: TxHandle,
    row: { id: string; userId: string; expiresAt: Date },
  ): Promise<string>;
  findSession(tx: TxHandle, id: string): Promise<SessionRecord | null>;
  revokeSessionsForUser(tx: TxHandle, userId: string, reason: string, at: Date): Promise<void>;
  insertRefreshToken(
    tx: TxHandle,
    row: {
      id: string;
      sessionId: string;
      userId: string;
      tokenHash: string;
      expiresAt: string;
      sessionExpiresAt: string;
    },
  ): Promise<void>;
  findRefreshTokenByHash(tx: TxHandle, tokenHash: string): Promise<RefreshTokenRecord | null>;
  markTokenRotated(tx: TxHandle, id: string, replacedById: string): Promise<void>;
  /** Sets app.user_id mid-transaction after a token resolved the user (session_guest_lookup). */
  assumeUser(tx: TxHandle, userId: string): Promise<void>;
}
export const AUTH_STORE = Symbol('AUTH_STORE');
