import { StorageError, StorageFailureReason } from '../domain/storage-errors';

/**
 * Drive error mapping (IP-5 Step 8, authorization B5). googleapis calls fail with
 * GaxiosError-shaped objects: an HTTP status in `response.status` (and often a string
 * `code` with the same number), or a transport-level error with a string `code` such as
 * ENOTFOUND and no response. This mapper classifies both shapes into the
 * provider-neutral StorageFailureReason set, so a permission problem, an auth failure,
 * rate limiting or a server error is NEVER mistaken for a missing object (which the
 * port represents as null/false, decided by lookup - never by catching a 404 here).
 *
 * No retries and no backoff live here: every mapped error is raised once, and the
 * caller (media-service) decides the safe external shape (STORAGE_FAILURE).
 */

/** The error attributes this mapper reads. Everything else is ignored (and may hold provider detail). */
export interface DriveErrorShape {
  readonly code?: number | string;
  readonly response?: { readonly status?: number };
  readonly message?: string;
}

const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ERR_NETWORK',
]);

function statusOf(err: DriveErrorShape): number | undefined {
  const fromResponse = err.response?.status;
  if (typeof fromResponse === 'number') return fromResponse;
  if (typeof err.code === 'number') return err.code;
  if (typeof err.code === 'string' && /^\d{3}$/.test(err.code)) return Number(err.code);
  return undefined;
}

function reasonOf(err: DriveErrorShape): StorageFailureReason {
  const status = statusOf(err);
  if (status === 404) return 'not_found';
  if (status === 403) return 'permission_denied';
  if (status === 401) return 'auth_failed';
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'invalid_request';
  if (status !== undefined && status >= 500) return 'server_error';
  if (typeof err.code === 'string' && NETWORK_CODES.has(err.code)) return 'network_error';
  // undici/Node fetch transport failures carry no status and a generic message
  if (typeof err.message === 'string' && err.message.includes('fetch failed')) {
    return 'network_error';
  }
  return 'unknown';
}

/** Maps any thrown Drive/googleapis failure to a classified PROVIDER_FAILURE StorageError. */
export function mapDriveError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;
  const shape: DriveErrorShape = typeof err === 'object' && err !== null ? err : {};
  return new StorageError('PROVIDER_FAILURE', reasonOf(shape));
}
