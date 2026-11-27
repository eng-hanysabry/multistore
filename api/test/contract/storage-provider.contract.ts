import { StorageProvider } from '../../src/modules/media/domain/storage-provider';

/**
 * Reusable StorageProvider contract suite (IP-5 Step 5, authorization item 12). Every
 * provider implementation — now the local test double, later the Drive adapter (Step 8)
 * — must pass this same suite unchanged. It is a library, not a spec file: each
 * provider's own spec calls storageProviderContract(...) with a factory.
 *
 * The suite never inspects provider internals; it only uses the port, so it cannot be
 * satisfied by accident through implementation-specific shortcuts.
 */
export function storageProviderContract(providerName: string, make: () => StorageProvider): void {
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
  const text = (b: Uint8Array): string => new TextDecoder().decode(b);
  let seq = 0;
  const key = (label: string): string =>
    `tenant-a/product-1/${providerName}-${Date.now()}-${seq++}-${label}`;

  describe(`StorageProvider contract: ${providerName}`, () => {
    it('stores an object and returns its reference metadata (key, content type, size)', async () => {
      const p = make();
      const k = key('store');
      const stored = await p.store({ key: k, bytes: bytes('hello'), contentType: 'image/webp' });
      expect(stored).toEqual({ key: k, contentType: 'image/webp', byteSize: 5 });
    });

    it('retrieves the exact stored bytes', async () => {
      const p = make();
      const k = key('roundtrip');
      const payload = bytes('binary-payload-☃-12345');
      await p.store({ key: k, bytes: payload, contentType: 'application/octet-stream' });
      const got = await p.retrieve(k);
      expect(got).not.toBeNull();
      expect(got?.contentType).toBe('application/octet-stream');
      expect(got?.byteSize).toBe(payload.byteLength);
      expect(got && text(got.bytes)).toBe('binary-payload-☃-12345');
    });

    it('missing object: retrieve returns null, delete returns false', async () => {
      const p = make();
      const k = key('missing');
      expect(await p.retrieve(k)).toBeNull();
      expect(await p.delete(k)).toBe(false);
    });

    it('deletion removes the object; repeated deletion is a safe false', async () => {
      const p = make();
      const k = key('delete');
      await p.store({ key: k, bytes: bytes('x'), contentType: 'image/png' });
      expect(await p.delete(k)).toBe(true);
      expect(await p.retrieve(k)).toBeNull();
      expect(await p.delete(k)).toBe(false);
    });

    it('content type is preserved per object, not per provider', async () => {
      const p = make();
      const k1 = key('ct-1');
      const k2 = key('ct-2');
      await p.store({ key: k1, bytes: bytes('a'), contentType: 'image/webp' });
      await p.store({ key: k2, bytes: bytes('b'), contentType: 'image/png' });
      expect((await p.retrieve(k1))?.contentType).toBe('image/webp');
      expect((await p.retrieve(k2))?.contentType).toBe('image/png');
    });

    it('tenant/object keys are isolated: same leaf name under different prefixes never collides', async () => {
      const p = make();
      const leaf = `${providerName}-${Date.now()}-iso`;
      const kA = `tenant-a/product-1/${leaf}`;
      const kB = `tenant-b/product-9/${leaf}`;
      await p.store({ key: kA, bytes: bytes('A'), contentType: 'image/webp' });
      await p.store({ key: kB, bytes: bytes('B'), contentType: 'image/webp' });
      expect((await p.retrieve(kA))?.bytes[0]).toBe(bytes('A')[0]);
      expect((await p.retrieve(kB))?.bytes[0]).toBe(bytes('B')[0]);
      await p.delete(kA);
      expect(await p.retrieve(kA)).toBeNull();
      expect((await p.retrieve(kB))?.bytes[0]).toBe(bytes('B')[0]);
    });

    it('invalid or unsupported object references are rejected, never silently accepted', async () => {
      const p = make();
      for (const bad of ['', '..', '../escape', '/absolute', 'a//b', 'a/../b', 'back\\slash']) {
        await expect(
          p.store({ key: bad, bytes: bytes('x'), contentType: 'image/png' }),
        ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
        await expect(p.retrieve(bad)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
        await expect(p.delete(bad)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
      }
      await expect(
        p.store({ key: key('bad-ct'), bytes: bytes('x'), contentType: 'not-a-mime-type' }),
      ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    });

    it('overwrite replaces the bytes of an existing key', async () => {
      const p = make();
      const k = key('overwrite');
      await p.store({ key: k, bytes: bytes('old'), contentType: 'image/webp' });
      const stored = await p.store({
        key: k,
        bytes: bytes('new-bytes'),
        contentType: 'image/webp',
      });
      expect(stored.byteSize).toBe(9);
      expect((await p.retrieve(k))?.bytes && text((await p.retrieve(k))?.bytes as Uint8Array)).toBe(
        'new-bytes',
      );
    });

    it('caller-side buffers and returned metadata cannot mutate stored content or leak internals', async () => {
      const p = make();
      const k = key('immutability');
      const input = bytes('original');
      const stored = await p.store({ key: k, bytes: input, contentType: 'image/webp' });
      input[0] = 88; // mutate after storing
      expect((await p.retrieve(k))?.bytes && text((await p.retrieve(k))?.bytes as Uint8Array)).toBe(
        'original',
      );
      // metadata carries no provider internals: no URL, path, bucket, etag or handle fields
      const ref = stored as unknown as Record<string, unknown>;
      expect(Object.keys(ref).sort()).toEqual(['byteSize', 'contentType', 'key']);
      const serialized = JSON.stringify(ref);
      for (const forbidden of ['http', 'gs://', 's3', 'drive', 'google', '/tmp', 'bucket']) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });
}
