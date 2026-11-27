import { StorageError } from './storage-errors';

/**
 * StorageProvider port (IP-5 Step 5; media pipeline design, drive_file_key model).
 *
 * The provider owns object bytes; the database owns metadata (media_assets rows). The
 * object key is the provider's reference and is stored as media_assets.drive_file_key
 * once the Drive adapter lands in Step 8 — the key model is provider-neutral by design,
 * so the accepted Batch 1 schema and the drive_file_key naming stay untouched.
 *
 * The port deliberately exposes no URLs, paths, bucket names or provider handles: a
 * StoredObject carries only the key, content type and byte size, so nothing
 * provider-specific can leak into a public API response through this abstraction.
 *
 * Key convention (all providers): slash-separated, e.g.
 * `{tenantId}/{productId}/{mediaId}` for product images and `{tenantId}/logo/{mediaId}`
 * for store logos — tenant isolation is part of the key itself.
 */

export const STORAGE_KEY_MAX = 512;
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,510}[a-zA-Z0-9_-]$/;
const CONTENT_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export function assertObjectKey(key: string): void {
  if (!KEY.test(key) || key.includes('..') || key.includes('//'))
    throw new StorageError('INVALID_REFERENCE');
}

export function assertContentType(contentType: string): void {
  if (!CONTENT_TYPE.test(contentType)) throw new StorageError('INVALID_REFERENCE');
}

export interface StoreObjectInput {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** Stored-object metadata: the key plus what the contract needs. Never a URL or path. */
export interface StoredObject {
  readonly key: string;
  readonly contentType: string;
  readonly byteSize: number;
}

export interface RetrievedObject extends StoredObject {
  readonly bytes: Uint8Array;
}

export interface StorageProvider {
  /** Stores the object at its key; overwriting an existing key replaces the bytes. */
  store(input: StoreObjectInput): Promise<StoredObject>;
  /** The exact stored bytes plus metadata, or null when the key does not exist. */
  retrieve(key: string): Promise<RetrievedObject | null>;
  /** True when an object was removed; false when the key did not exist (idempotent-safe). */
  delete(key: string): Promise<boolean>;
}
