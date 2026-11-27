import {
  RetrievedObject,
  StorageProvider,
  StoreObjectInput,
  StoredObject,
  assertContentType,
  assertObjectKey,
} from '../domain/storage-provider';

/**
 * In-memory StorageProvider test double (IP-5 Step 5). The only provider implementation
 * authorized in Batch 2: no Drive adapter, no OAuth, no network, no filesystem. It
 * exists so provider contract tests and future media use cases run without external
 * services; the Drive adapter (Step 8, separately approved) must pass the same contract
 * suite.
 */
export class LocalStorageDouble implements StorageProvider {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async store(input: StoreObjectInput): Promise<StoredObject> {
    assertObjectKey(input.key);
    assertContentType(input.contentType);
    // Copy on write: later caller mutations of the input buffer never change stored bytes.
    this.objects.set(input.key, {
      bytes: new Uint8Array(input.bytes),
      contentType: input.contentType,
    });
    return Promise.resolve({
      key: input.key,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
    });
  }

  async retrieve(key: string): Promise<RetrievedObject | null> {
    assertObjectKey(key);
    const hit = this.objects.get(key);
    if (!hit) return Promise.resolve(null);
    // Copy on read: callers can never mutate the stored bytes through the result.
    return Promise.resolve({
      key,
      contentType: hit.contentType,
      byteSize: hit.bytes.byteLength,
      bytes: new Uint8Array(hit.bytes),
    });
  }

  async delete(key: string): Promise<boolean> {
    assertObjectKey(key);
    return Promise.resolve(this.objects.delete(key));
  }
}
