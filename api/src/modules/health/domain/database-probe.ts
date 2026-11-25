export interface DatabaseReadiness {
  /** SELECT 1 succeeded as the runtime role. */
  readonly databaseOk: boolean;
  /** Canary: zero rows without tenant context, the fixed row with it (spec 10.7, NULLIF form). */
  readonly rlsCanaryOk: boolean;
}

export interface RuntimeRole {
  readonly user: string;
  readonly superuser: boolean;
  readonly bypassRls: boolean;
}

export interface DatabaseProbe {
  readiness(): Promise<DatabaseReadiness>;
  runtimeRole(): Promise<RuntimeRole>;
}
export const DATABASE_PROBE = Symbol('DATABASE_PROBE');

export class RoleViolationError extends Error {
  override readonly name = 'RoleViolationError';
}

/** Boot check (10.7): refuse to start unless connected as multistore_app, no superuser, no BYPASSRLS. */
export async function assertRuntimeRole(probe: DatabaseProbe): Promise<void> {
  const r = await probe.runtimeRole();
  const problems: string[] = [];
  if (r.user !== 'multistore_app') problems.push('connected role is not multistore_app');
  if (r.superuser) problems.push('role is a superuser');
  if (r.bypassRls) problems.push('role has BYPASSRLS');
  if (problems.length > 0)
    throw new RoleViolationError(`Refusing to start: ${problems.join('; ')}`);
}
