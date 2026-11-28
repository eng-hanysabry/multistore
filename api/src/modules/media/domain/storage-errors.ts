/**
 * Storage provider error codes (IP-5 Step 5). Kept separate from the HTTP layer: the
 * provider port is infrastructure-facing, and the API decides the safe external shape.
 * INVALID_REFERENCE: the caller's key or content type violates the port rules.
 * PROVIDER_FAILURE (Step 8): the provider itself failed; `reason` classifies it for
 * logs/ops while the API layer keeps mapping any provider failure to STORAGE_FAILURE.
 */
export type StorageErrorCode = 'INVALID_REFERENCE' | 'PROVIDER_FAILURE';

/** Coarse, provider-neutral classification of a PROVIDER_FAILURE (B5 of the Step 8 authorization). */
export type StorageFailureReason =
  | 'not_found'
  | 'permission_denied'
  | 'auth_failed'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'invalid_request'
  | 'conflict'
  | 'unknown';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    public readonly reason?: StorageFailureReason,
  ) {
    super(reason === undefined ? code : `${code}:${reason}`);
    this.name = 'StorageError';
  }
}
