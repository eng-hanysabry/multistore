import { redactValue, safeDatabaseUrl } from '../logging/redact';

export class ConfigError extends Error {
  constructor(public readonly problems: readonly string[]) {
    // Messages name the variable and the rule, never the value.
    super(`Invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly adminDatabaseUrl: string | undefined;
  readonly jwtSecret: string;
}

export const REQUIRED_APP_ROLE = 'multistore_app';

function parsePgUrl(name: string, value: string | undefined, problems: string[]): URL | undefined {
  if (!value) {
    problems.push(`${name} is required`);
    return undefined;
  }
  try {
    const u = new URL(value);
    if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
      problems.push(`${name} must be a postgresql:// URL`);
      return undefined;
    }
    return u;
  } catch {
    problems.push(`${name} is not a valid URL`);
    return undefined;
  }
}

/** Database login name, ignoring a pooler tenant suffix such as multistore_app.<project-ref>. */
export function dbUserOf(url: URL): string {
  return decodeURIComponent(url.username).split('.')[0] ?? '';
}

/** Typed configuration, validated at boot. Throws ConfigError listing every problem. */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const problems: string[] = [];
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    problems.push('NODE_ENV must be development, test or production');
  }
  const port = Number(env['PORT'] ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be 1-65535');

  const db = parsePgUrl('DATABASE_URL', env['DATABASE_URL'], problems);
  // The runtime API connection string logs in as multistore_app, never postgres or the owner (6.4).
  if (db && dbUserOf(db) !== REQUIRED_APP_ROLE) {
    problems.push(`DATABASE_URL must log in as ${REQUIRED_APP_ROLE}`);
  }
  const adminRaw = env['ADMIN_DATABASE_URL'];
  let adminUrl: URL | undefined;
  if (adminRaw) {
    adminUrl = parsePgUrl('ADMIN_DATABASE_URL', adminRaw, problems);
    if (adminUrl && dbUserOf(adminUrl) !== 'multistore_admin') {
      problems.push('ADMIN_DATABASE_URL must log in as multistore_admin');
    }
  }
  const jwt = env['JWT_SECRET'];
  if (!jwt || jwt.length < 32)
    problems.push('JWT_SECRET is required and must be at least 32 characters');

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv: nodeEnv as AppConfig['nodeEnv'],
    port,
    databaseUrl: env['DATABASE_URL'] as string,
    adminDatabaseUrl: adminRaw || undefined,
    jwtSecret: jwt as string,
  };
}

/** Loggable view of the config: secrets by name, database URLs without credentials. */
export function describeConfig(cfg: AppConfig): Record<string, unknown> {
  return redactValue({
    nodeEnv: cfg.nodeEnv,
    port: cfg.port,
    databaseUrl: safeDatabaseUrl(cfg.databaseUrl),
    adminDatabaseUrl: cfg.adminDatabaseUrl ? safeDatabaseUrl(cfg.adminDatabaseUrl) : undefined,
    jwtSecret: cfg.jwtSecret,
  }) as Record<string, unknown>;
}
