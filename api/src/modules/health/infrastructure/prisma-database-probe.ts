import { PrismaClient } from '@prisma/client';
import { DatabaseProbe, DatabaseReadiness, RuntimeRole } from '../domain/database-probe';

const CANARY_TENANT = '00000000-0000-4000-8000-0000000000c2';

export class PrismaDatabaseProbe implements DatabaseProbe {
  constructor(private readonly db: PrismaClient) {}

  async readiness(): Promise<DatabaseReadiness> {
    try {
      // One transaction proves both the connection and the RLS context (fewest round trips).
      const rlsCanaryOk = await this.db.$transaction(
        async (tx) => {
          // Pooled connections may hold an empty string from an earlier transaction: this first
          // query must return zero rows, not an error (NULLIF form, 6.2).
          const without = await tx.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM rls_canary`;
          await tx.$queryRaw`SELECT set_config('app.role', 'GUEST', true), set_config('app.tenant_id', ${CANARY_TENANT}, true)`;
          const withCtx = await tx.$queryRaw<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM rls_canary`;
          return Number(without[0]?.n) === 0 && Number(withCtx[0]?.n) === 1;
        },
        { timeout: 2_000, maxWait: 1_000 },
      );
      return { databaseOk: true, rlsCanaryOk };
    } catch {
      // The transaction failed: either the database is down or the canary is broken. Tell them apart.
      try {
        await this.db.$queryRaw`SELECT 1`;
        return { databaseOk: true, rlsCanaryOk: false };
      } catch {
        return { databaseOk: false, rlsCanaryOk: false };
      }
    }
  }

  async runtimeRole(): Promise<RuntimeRole> {
    const rows = await this.db.$queryRaw<{ u: string; s: boolean; b: boolean }[]>`
      SELECT current_user::text AS u, r.rolsuper AS s, r.rolbypassrls AS b
      FROM pg_roles r WHERE r.rolname = current_user`;
    const r = rows[0];
    if (!r) throw new Error('role not found');
    return { user: r.u, superuser: r.s, bypassRls: r.b };
  }
}
