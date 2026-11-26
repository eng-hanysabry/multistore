import { PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { CodePurpose } from '../domain/auth-rules';
import {
  AuthCodeRecord,
  AuthStore,
  RefreshTokenRecord,
  SessionRecord,
  UserRecord,
} from '../domain/auth-store';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

/** Auth persistence through the caller's transaction; RLS does the authorization (6.3). */
export class PrismaAuthStore implements AuthStore {
  async findUserByLoginEmail(tx: TxHandle, email: string): Promise<UserRecord | null> {
    const rows = await txOf(tx).$queryRaw<
      { id: string; email: string; password_hash: string; status: UserRecord['status'] }[]
    >`SELECT id::text, email, password_hash, status FROM users WHERE email = ${email}`;
    const r = rows[0];
    return r ? { id: r.id, email: r.email, passwordHash: r.password_hash, status: r.status } : null;
  }

  async findUserById(tx: TxHandle, id: string): Promise<UserRecord | null> {
    const rows = await txOf(tx).$queryRaw<
      { id: string; email: string; password_hash: string; status: UserRecord['status'] }[]
    >`SELECT id::text, email, password_hash, status FROM users WHERE id = ${id}::uuid`;
    const r = rows[0];
    return r ? { id: r.id, email: r.email, passwordHash: r.password_hash, status: r.status } : null;
  }

  async insertPendingUser(
    tx: TxHandle,
    row: { id: string; email: string; passwordHash: string },
  ): Promise<void> {
    await txOf(tx).$executeRaw`
      INSERT INTO users (id, email, password_hash, status)
      VALUES (${row.id}::uuid, ${row.email}, ${row.passwordHash}, 'PENDING_VERIFICATION')`;
  }

  async insertAuthCode(
    tx: TxHandle,
    row: { id: string; userId: string; purpose: CodePurpose; codeHash: string; expiresAt: Date },
  ): Promise<void> {
    await txOf(tx).$executeRaw`
      INSERT INTO auth_codes (id, user_id, purpose, code_hash, expires_at)
      VALUES (${row.id}::uuid, ${row.userId}::uuid, ${row.purpose}, ${row.codeHash}, ${row.expiresAt})`;
  }

  async latestAuthCode(
    tx: TxHandle,
    userId: string,
    purpose: CodePurpose,
  ): Promise<AuthCodeRecord | null> {
    const rows = await txOf(tx).$queryRaw<
      {
        id: string;
        user_id: string;
        purpose: CodePurpose;
        code_hash: string;
        expires_at: Date;
        attempts: number;
        consumed_at: Date | null;
        created_at: Date;
      }[]
    >`SELECT id::text, user_id::text, purpose, code_hash, expires_at, attempts, consumed_at, created_at
      FROM auth_codes WHERE user_id = ${userId}::uuid AND purpose = ${purpose}
      ORDER BY created_at DESC LIMIT 1`;
    const r = rows[0];
    return r
      ? {
          id: r.id,
          userId: r.user_id,
          purpose: r.purpose,
          codeHash: r.code_hash,
          expiresAt: r.expires_at,
          attempts: r.attempts,
          consumedAt: r.consumed_at,
          createdAt: r.created_at,
        }
      : null;
  }

  async countAuthCodesSince(
    tx: TxHandle,
    userId: string,
    purpose: CodePurpose,
    since: Date,
  ): Promise<number> {
    const rows = await txOf(tx).$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM auth_codes
      WHERE user_id = ${userId}::uuid AND purpose = ${purpose} AND created_at >= ${since}`;
    return Number(rows[0]?.n ?? 0);
  }

  async incrementCodeAttempts(tx: TxHandle, codeId: string): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ${codeId}::uuid`;
  }

  async consumeAuthCode(tx: TxHandle, codeId: string, at: Date): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE auth_codes SET consumed_at = ${at} WHERE id = ${codeId}::uuid`;
  }

  async activateUser(tx: TxHandle, email: string, at: Date): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE users SET status = 'ACTIVE', email_verified_at = ${at}, updated_at = ${at}
      WHERE email = ${email}`;
  }

  async updatePasswordByEmail(
    tx: TxHandle,
    email: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE users SET password_hash = ${passwordHash}, password_changed_at = ${changedAt}, updated_at = ${changedAt}
      WHERE email = ${email}`;
  }

  async updatePasswordById(
    tx: TxHandle,
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE users SET password_hash = ${passwordHash}, password_changed_at = ${changedAt}, updated_at = ${changedAt}
      WHERE id = ${id}::uuid`;
  }

  async insertSession(
    tx: TxHandle,
    row: { id: string; userId: string; expiresAt: Date },
  ): Promise<string> {
    // expires_at is returned as text: the refresh-token row must carry the exact same value
    // (correction A equality check); a JS Date round-trip would lose sub-millisecond digits.
    const rows = await txOf(tx).$queryRaw<{ expires_at: string }[]>`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${row.id}::uuid, ${row.userId}::uuid, ${row.expiresAt})
      RETURNING expires_at::text`;
    const text = rows[0]?.expires_at;
    if (!text) throw new Error('session insert returned no expiry');
    return text;
  }

  async findSession(tx: TxHandle, id: string): Promise<SessionRecord | null> {
    const rows = await txOf(tx).$queryRaw<
      { id: string; user_id: string; expires_at: string; revoked_at: Date | null }[]
    >`SELECT id::text, user_id::text, expires_at::text, revoked_at FROM sessions WHERE id = ${id}::uuid`;
    const r = rows[0];
    return r
      ? { id: r.id, userId: r.user_id, expiresAt: r.expires_at, revokedAt: r.revoked_at }
      : null;
  }

  async revokeSessionsForUser(
    tx: TxHandle,
    userId: string,
    reason: string,
    at: Date,
  ): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE sessions SET revoked_at = ${at}, revoked_reason = ${reason}
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;
  }

  async insertRefreshToken(
    tx: TxHandle,
    row: {
      id: string;
      sessionId: string;
      userId: string;
      tokenHash: string;
      expiresAt: string;
      sessionExpiresAt: string;
    },
  ): Promise<void> {
    await txOf(tx).$executeRaw`
      INSERT INTO refresh_tokens (id, session_id, user_id, token_hash, status, expires_at, session_expires_at)
      VALUES (${row.id}::uuid, ${row.sessionId}::uuid, ${row.userId}::uuid, ${row.tokenHash},
              'ACTIVE', ${row.expiresAt}, ${row.sessionExpiresAt})`;
  }

  async findRefreshTokenByHash(
    tx: TxHandle,
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null> {
    const rows = await txOf(tx).$queryRaw<
      {
        id: string;
        session_id: string;
        user_id: string;
        status: RefreshTokenRecord['status'];
        expires_at: Date;
      }[]
    >`SELECT id::text, session_id::text, user_id::text, status, expires_at
      FROM refresh_tokens WHERE token_hash = ${tokenHash}`;
    const r = rows[0];
    return r
      ? {
          id: r.id,
          sessionId: r.session_id,
          userId: r.user_id,
          status: r.status,
          expiresAt: r.expires_at,
        }
      : null;
  }

  async markTokenRotated(tx: TxHandle, id: string, replacedById: string): Promise<void> {
    await txOf(tx).$executeRaw`
      UPDATE refresh_tokens SET status = 'ROTATED', replaced_by_id = ${replacedById}::uuid
      WHERE id = ${id}::uuid`;
  }

  async assumeUser(tx: TxHandle, userId: string): Promise<void> {
    await txOf(tx).$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
  }
}
