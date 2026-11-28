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
  /** Present only when every Gmail variable is set. Without it mail reports DEGRADED (not_configured). */
  readonly gmail: GmailConfig | undefined;
  /**
   * 'loop': an in-process worker polls the outbox (always-on host).
   * 'sweep': no background loop (serverless host); mail is sent right after it is queued and an
   * authenticated scheduled request to /internal/outbox/drain retries what is still pending.
   */
  readonly outboxMode: 'loop' | 'sweep';
  /** Bearer secret for /internal/outbox/drain. Required in sweep mode. */
  readonly cronSecret: string | undefined;
  /**
   * Object storage provider selection (IP-5 Step 8, B6). 'local' (default): the
   * in-memory LocalStorageDouble for local runs and tests. 'drive': the Drive adapter,
   * which then requires every GOOGLE_DRIVE_* variable (fail fast at boot when missing).
   */
  readonly storageProvider: 'local' | 'drive';
  /** Present only when STORAGE_PROVIDER=drive; all values are secrets except folderId. */
  readonly drive: DriveConfig | undefined;
  /**
   * G-12 public catalog rate limiting (IP-5 Step 9). `limit` requests per `ttlMs`
   * milliseconds per client IP per endpoint, tracked in memory by @nestjs/throttler.
   * `trustedProxy`: 'none' (default; local, tests, and any deployment where the API
   * origin is reachable directly) tracks the socket IP and ignores every client-sent
   * forwarded header. 'vercel' trusts only the leftmost value of x-vercel-forwarded-for,
   * which Vercel overwrites at its edge; it is valid only while the origin cannot be
   * reached except through Vercel (see docs/ip5/IP5_step9_notes.md).
   */
  readonly publicRateLimit: PublicRateLimitConfig;
}

export interface PublicRateLimitConfig {
  readonly limit: number;
  readonly ttlMs: number;
  readonly trustedProxy: 'none' | 'vercel';
}

export interface DriveConfig {
  readonly folderId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface GmailConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** GMAIL_ALLOWED_ACCOUNT (9.1.1): also the From address. */
  readonly account: string;
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

  const gmailVars = [
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_ALLOWED_ACCOUNT',
  ];
  const setVars = gmailVars.filter((k) => Boolean(env[k]));
  let gmail: GmailConfig | undefined;
  if (setVars.length > 0 && setVars.length < gmailVars.length) {
    problems.push(`Gmail settings are all-or-none: set all of ${gmailVars.join(', ')}`);
  } else if (setVars.length === gmailVars.length) {
    const account = (env['GMAIL_ALLOWED_ACCOUNT'] as string).trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(account))
      problems.push('GMAIL_ALLOWED_ACCOUNT must be an email address');
    gmail = {
      clientId: env['GMAIL_CLIENT_ID'] as string,
      clientSecret: env['GMAIL_CLIENT_SECRET'] as string,
      refreshToken: env['GMAIL_REFRESH_TOKEN'] as string,
      account,
    };
  }

  const provider = env['STORAGE_PROVIDER'] ?? 'local';
  if (provider !== 'local' && provider !== 'drive') {
    problems.push('STORAGE_PROVIDER must be local or drive');
  }
  let drive: DriveConfig | undefined;
  if (provider === 'drive') {
    const driveVars = [
      'GOOGLE_DRIVE_FOLDER_ID',
      'GOOGLE_DRIVE_CLIENT_ID',
      'GOOGLE_DRIVE_CLIENT_SECRET',
      'GOOGLE_DRIVE_REFRESH_TOKEN',
    ];
    const missing = driveVars.filter((k) => !env[k]);
    if (missing.length > 0) {
      problems.push(
        `STORAGE_PROVIDER=drive requires all of ${driveVars.join(', ')}; missing: ${missing.join(', ')}`,
      );
    } else {
      drive = {
        folderId: env['GOOGLE_DRIVE_FOLDER_ID'] as string,
        clientId: env['GOOGLE_DRIVE_CLIENT_ID'] as string,
        clientSecret: env['GOOGLE_DRIVE_CLIENT_SECRET'] as string,
        refreshToken: env['GOOGLE_DRIVE_REFRESH_TOKEN'] as string,
      };
    }
  }

  const mode = env['OUTBOX_MODE'] ?? 'loop';
  if (mode !== 'loop' && mode !== 'sweep') problems.push('OUTBOX_MODE must be loop or sweep');
  const cron = env['CRON_SECRET'] || undefined;
  if (cron !== undefined && cron.length < 32)
    problems.push('CRON_SECRET must be at least 32 characters');
  if (mode === 'sweep' && cron === undefined)
    problems.push('CRON_SECRET is required when OUTBOX_MODE=sweep');

  const rateLimitRaw = Number(env['PUBLIC_CATALOG_RATE_LIMIT'] ?? '60');
  if (!Number.isInteger(rateLimitRaw) || rateLimitRaw < 1) {
    problems.push('PUBLIC_CATALOG_RATE_LIMIT must be a positive integer');
  }
  const rateLimitTtlRaw = Number(env['PUBLIC_CATALOG_RATE_LIMIT_TTL_MS'] ?? '60000');
  if (!Number.isInteger(rateLimitTtlRaw) || rateLimitTtlRaw < 1) {
    problems.push('PUBLIC_CATALOG_RATE_LIMIT_TTL_MS must be a positive integer of milliseconds');
  }
  const trustedProxyRaw = env['PUBLIC_CATALOG_TRUSTED_PROXY'] ?? 'none';
  if (trustedProxyRaw !== 'none' && trustedProxyRaw !== 'vercel') {
    problems.push('PUBLIC_CATALOG_TRUSTED_PROXY must be none or vercel');
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv: nodeEnv as AppConfig['nodeEnv'],
    port,
    databaseUrl: env['DATABASE_URL'] as string,
    adminDatabaseUrl: adminRaw || undefined,
    jwtSecret: jwt as string,
    gmail,
    outboxMode: mode as AppConfig['outboxMode'],
    cronSecret: cron,
    storageProvider: provider as AppConfig['storageProvider'],
    drive,
    publicRateLimit: {
      limit: rateLimitRaw,
      ttlMs: rateLimitTtlRaw,
      trustedProxy: trustedProxyRaw as PublicRateLimitConfig['trustedProxy'],
    },
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
    outboxMode: cfg.outboxMode,
    cronSecret: cfg.cronSecret,
    gmailConfigured: cfg.gmail !== undefined,
    gmailAccount: cfg.gmail ? '[set]' : undefined,
    storageProvider: cfg.storageProvider,
    driveConfigured: cfg.drive !== undefined,
    publicRateLimit: cfg.publicRateLimit,
  }) as Record<string, unknown>;
}
