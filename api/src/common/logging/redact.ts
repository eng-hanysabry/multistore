/**
 * Redaction at the sink (spec 6.8). Used by the logging path itself, so a careless
 * logger.log(config) cannot leak.
 */
export const REDACTED = '[REDACTED]';

/** Config and field names whose value is never logged. Matching is case-insensitive substring. */
export const SECRET_KEY_PATTERNS: readonly string[] = [
  'database_url',
  'admin_database_url',
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'api_key',
  'apikey',
  'private_key',
  'jwt',
  'client_secret',
  'refresh',
  'connection_string',
];

export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((p) => k.includes(p));
}

const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+)(?::[^\s/@]*)?@/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const GOOGLE_ACCESS = /\bya29\.[A-Za-z0-9._-]{10,}/g;
const GOOGLE_REFRESH = /\b1\/\/[A-Za-z0-9._-]{20,}/g;

export interface RedactOptions {
  /** Exact secret values to remove, in full or in any recognizable part (see minPartLength). */
  knownSecrets?: readonly string[];
  /** Fragments of at least this length of a known secret are also removed. */
  minPartLength?: number;
}

/** Removes secrets from free text: URL credentials, bearer tokens, JWTs, Google tokens, known values. */
export function redactString(input: string, opts: RedactOptions = {}): string {
  let out = input
    .replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${REDACTED}@`)
    .replace(BEARER, (_m, kind: string) => `${kind} ${REDACTED}`)
    .replace(JWT_LIKE, REDACTED)
    .replace(GOOGLE_ACCESS, REDACTED)
    .replace(GOOGLE_REFRESH, REDACTED);
  const minPart = opts.minPartLength ?? 8;
  for (const secret of opts.knownSecrets ?? []) {
    if (secret.length < minPart) continue;
    out = out.split(secret).join(REDACTED);
    // any recognizable part: every window of minPart characters of the secret
    for (let i = 0; i + minPart <= secret.length; i++) {
      out = out.split(secret.slice(i, i + minPart)).join(REDACTED);
    }
  }
  return out;
}

/** Deep-redacts a value: secret-named keys by name, strings by pattern. Never mutates the input. */
export function redactValue(value: unknown, opts: RedactOptions = {}, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, opts, depth + 1));
  if (value instanceof Error) {
    // Stack traces are never emitted (spec 6.8 item 2): name and safe message only.
    return { name: value.name, message: redactString(value.message, opts) };
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redactValue(v, opts, depth + 1);
    }
    return out;
  }
  return value;
}

/** Logs a database URL without credentials (host, port, database and user name only is not kept). */
export function safeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return REDACTED;
  }
}
