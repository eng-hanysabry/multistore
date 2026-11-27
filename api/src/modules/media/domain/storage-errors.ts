/**
 * Storage provider error codes (IP-5 Step 5). Kept separate from the HTTP layer: the
 * provider port is infrastructure-facing, and the API decides the safe external shape.
 */
export type StorageErrorCode = 'INVALID_REFERENCE';

export class StorageError extends Error {
  constructor(public readonly code: StorageErrorCode) {
    super(code);
    this.name = 'StorageError';
  }
}
