import { MediaService, MerchantScope } from '../../src/modules/media/application/media-service';
import { ImageProcessor, ProcessedImage } from '../../src/modules/media/domain/image-processor';
import { MediaIdempotencyRepository } from '../../src/modules/media/domain/media-idempotency-repository';
import { MediaError } from '../../src/modules/media/domain/media-errors';
import {
  MediaRecord,
  MediaRepository,
  NewMediaRow,
} from '../../src/modules/media/domain/media-repository';
import {
  MediaStatus,
  VariantsJson,
  variantObjectKey,
} from '../../src/modules/media/domain/media-rules';
import { LocalStorageDouble } from '../../src/modules/media/infrastructure/local-storage-double';
import { TxHandle } from '../../src/common/tenancy/tenant-transaction-runner';

/**
 * Media use-case unit tests with fake persistence and a fake processor (5.3). The
 * storage provider is the real LocalStorageDouble so object bytes and compensation are
 * exercised for real; the double is configured to fail on demand for the section-10
 * partial-failure paths.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '55555555-5555-4555-8555-555555555555';
const scope: MerchantScope = { tenantId: TENANT, userId: USER };

class FakeRepo implements MediaRepository {
  rows = new Map<string, MediaRecord>();
  productStatusValue: 'DRAFT' | 'PUBLISHED' | null = 'DRAFT';
  failInsert = false;

  async insert(_tx: TxHandle, row: NewMediaRow): Promise<void> {
    if (this.failInsert) throw new Error('db down');
    this.rows.set(row.id, {
      ...row,
      tenantId: TENANT,
      createdAt: '2026-11-27T00:00:00Z',
      updatedAt: '2026-11-27T00:00:00Z',
    });
  }
  async findById(_tx: TxHandle, id: string): Promise<MediaRecord | null> {
    return this.rows.get(id) ?? null;
  }
  async listByProduct(_tx: TxHandle, productId: string): Promise<MediaRecord[]> {
    return [...this.rows.values()].filter((r) => r.productId === productId);
  }
  async replaceObjects(
    _tx: TxHandle,
    id: string,
    next: {
      driveFileKey: string;
      contentType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
      variants: VariantsJson;
    },
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    this.rows.set(id, {
      ...row,
      driveFileKey: next.driveFileKey,
      contentType: next.contentType,
      byteSize: next.byteSize,
      widthPx: next.widthPx,
      heightPx: next.heightPx,
      variants: next.variants,
      status: 'ACTIVE',
    });
    return true;
  }
  async setStatus(_tx: TxHandle, id: string, status: MediaStatus): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    this.rows.set(id, { ...row, status });
    return true;
  }
  async deleteById(_tx: TxHandle, id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
  async productStatus(): Promise<'DRAFT' | 'PUBLISHED' | null> {
    return this.productStatusValue;
  }
}

class FakeIdempotency implements MediaIdempotencyRepository {
  records = new Map<
    string,
    { requestHash: string; responseStatus: number; responseBody: unknown }
  >();
  async find(
    _tx: TxHandle,
    action: string,
    key: string,
  ): Promise<{ requestHash: string; responseStatus: number; responseBody: unknown } | null> {
    return this.records.get(`${action}:${key}`) ?? null;
  }
  async insert(
    _tx: TxHandle,
    row: {
      action?: string;
      key: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
    },
  ): Promise<boolean> {
    const k = `${(row as { action?: string }).action ?? 'media.upload'}:${row.key}`;
    if (this.records.has(k)) return false;
    this.records.set(k, {
      requestHash: row.requestHash,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
    });
    return true;
  }
}

class FailingStorage extends LocalStorageDouble {
  failOnStoreKeys: string[] = [];
  failOnDeleteKeys: string[] = [];
  override async store(input: { key: string; bytes: Uint8Array; contentType: string }) {
    if (this.failOnStoreKeys.some((k) => input.key.includes(k))) throw new Error('store failed');
    return super.store(input);
  }
  override async delete(key: string): Promise<boolean> {
    if (this.failOnDeleteKeys.some((k) => key.includes(k))) throw new Error('delete failed');
    return super.delete(key);
  }
  keys(): string[] {
    return [...(this as unknown as { objects: Map<string, unknown> }).objects.keys()];
  }
}

const processedImage = (bytes = 1000): ProcessedImage => ({
  widthPx: 800,
  heightPx: 600,
  variants: {
    original: {
      key: '',
      widthPx: 800,
      heightPx: 600,
      byteSize: bytes,
      bytes: new Uint8Array(bytes).fill(1),
    },
    thumb: {
      key: '',
      widthPx: 256,
      heightPx: 192,
      byteSize: 100,
      bytes: new Uint8Array(100).fill(2),
    },
    display: {
      key: '',
      widthPx: 800,
      heightPx: 600,
      byteSize: 300,
      bytes: new Uint8Array(300).fill(3),
    },
  },
});

class FakeProcessor implements ImageProcessor {
  next: ProcessedImage = processedImage();
  async process(): Promise<ProcessedImage> {
    return this.next;
  }
}

const runner = {
  run: <T>(_ctx: unknown, work: (tx: TxHandle) => Promise<T>): Promise<T> => work({}),
};

let seq = 0;
const ids = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const setup = () => {
  const repo = new FakeRepo();
  const idem = new FakeIdempotency();
  const storage = new FailingStorage();
  const processor = new FakeProcessor();
  const service = new MediaService(runner, repo, idem, storage, processor, ids);
  return { repo, idem, storage, processor, service };
};

const file = { bytes: new Uint8Array([9, 9, 9]), originalFilename: 'photo.png' };

describe('MediaService upload', () => {
  it('stores all three variants with server-generated keys and activates the row', async () => {
    const { service, repo, storage } = setup();
    const result = await service.upload(scope, PRODUCT, file);
    expect(result.status).toBe(201);
    const row = [...repo.rows.values()][0] as MediaRecord;
    expect(row.status).toBe('ACTIVE');
    expect(row.kind).toBe('PRODUCT_IMAGE');
    expect(row.contentType).toBe('image/webp');
    expect(row.widthPx).toBe(800);
    const keys = [row.variants?.original.key, row.variants?.thumb.key, row.variants?.display.key];
    for (const k of keys) {
      expect(k).toMatch(
        new RegExp(`^media/${TENANT}/${row.id}/(original|thumb|display)/[0-9a-f-]{36}$`),
      );
      expect(k).not.toContain('photo.png');
    }
    expect(row.driveFileKey).toBe(row.variants?.original.key);
    // exact bytes retrievable per variant (contract-level check through the double)
    expect((await storage.retrieve(keys[0] as string))?.bytes).toEqual(
      new Uint8Array(1000).fill(1),
    );
    expect((await storage.retrieve(keys[1] as string))?.bytes).toEqual(new Uint8Array(100).fill(2));
    expect((await storage.retrieve(keys[2] as string))?.bytes).toEqual(new Uint8Array(300).fill(3));
    // the API view never carries a key
    expect(JSON.stringify(result.body)).not.toContain('media/');
  });

  it('rejects a product that does not exist with NOT_FOUND and stores nothing extra', async () => {
    const { service, repo, storage } = setup();
    repo.productStatusValue = null;
    await expect(service.upload(scope, PRODUCT, file)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect([...repo.rows.values()].filter((r) => r.status === 'ACTIVE')).toHaveLength(0);
    // metadata failure compensation removed the stored objects
    expect(storage.keys()).toHaveLength(0);
  });

  it('partial variant storage failure: compensates stored objects, no ACTIVE row', async () => {
    const { service, repo, storage } = setup();
    storage.failOnStoreKeys = ['/display/'];
    await expect(service.upload(scope, PRODUCT, file)).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
    });
    expect([...repo.rows.values()].filter((r) => r.status === 'ACTIVE')).toHaveLength(0);
    expect(storage.keys()).toHaveLength(0); // original+thumb compensated
  });

  it('failed cleanup preserves the object reference in an ORPHANED row', async () => {
    const { service, repo, storage } = setup();
    storage.failOnStoreKeys = ['/display/'];
    storage.failOnDeleteKeys = ['/thumb/']; // compensation delete of thumb fails
    await expect(service.upload(scope, PRODUCT, file)).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
    });
    const orphans = [...repo.rows.values()].filter((r) => r.status === 'ORPHANED');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.driveFileKey).toContain('/thumb/');
    expect(storage.keys()).toEqual([orphans[0]?.driveFileKey]); // object still exists
  });

  it('metadata persistence failure after storage: objects compensated, error propagated', async () => {
    const { service, repo, storage } = setup();
    repo.failInsert = true;
    await expect(service.upload(scope, PRODUCT, file)).rejects.toThrow('db down');
    expect(storage.keys()).toHaveLength(0);
    expect(repo.rows.size).toBe(0);
  });

  it('idempotency: replay returns the stored first result; a different payload conflicts', async () => {
    const { service } = setup();
    const first = await service.upload(scope, PRODUCT, file, 'k1');
    const replay = await service.upload(scope, PRODUCT, file, 'k1');
    expect(replay.replayed).toBe(true);
    expect(replay.body.id).toBe(first.body.id);
    await expect(
      service.upload(scope, PRODUCT, { bytes: new Uint8Array([1]) }, 'k1'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('MediaService replace', () => {
  it('swaps to new keys and deletes old objects only after the commit', async () => {
    const { service, repo, storage } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    const id = up.body.id;
    const oldKeys = [...storage.keys()];
    const view = await service.replace(scope, PRODUCT, id, { bytes: new Uint8Array([7]) });
    const row = [...repo.rows.values()].find((r) => r.id === id) as MediaRecord;
    const newKeys = [
      row.variants?.original.key,
      row.variants?.thumb.key,
      row.variants?.display.key,
    ];
    for (const nk of newKeys) expect(oldKeys).not.toContain(nk);
    for (const ok of oldKeys) expect(await storage.retrieve(ok)).toBeNull();
    for (const nk of newKeys) expect(await storage.retrieve(nk as string)).not.toBeNull();
    expect(view.status).toBe('ACTIVE');
  });

  it('replacement of a published product image is allowed (update, not delete)', async () => {
    const { service, repo } = setup();
    repo.productStatusValue = 'PUBLISHED';
    const up = await service.upload(scope, PRODUCT, file);
    const view = await service.replace(scope, PRODUCT, up.body.id, { bytes: new Uint8Array([7]) });
    expect(view.id).toBe(up.body.id);
  });

  it('a failed old-object delete keeps the old key in an ORPHANED row', async () => {
    const { service, repo, storage } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    const oldOriginal = (await storage.keys()).find((k) => k.includes('/original/')) as string;
    storage.failOnDeleteKeys = [oldOriginal];
    await service.replace(scope, PRODUCT, up.body.id, { bytes: new Uint8Array([7]) });
    const orphans = [...repo.rows.values()].filter((r) => r.status === 'ORPHANED');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.driveFileKey).toBe(oldOriginal);
    expect(await storage.retrieve(oldOriginal)).not.toBeNull(); // object preserved
  });

  it('replaces nothing when the media belongs to another product', async () => {
    const { service } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    await expect(
      service.replace(scope, '66666666-6666-4666-8666-666666666666', up.body.id, file),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('MediaService delete', () => {
  it('deletes the row and the external objects for a DRAFT product', async () => {
    const { service, repo, storage } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    const result = await service.deleteMedia(scope, PRODUCT, up.body.id);
    expect(result.status).toBe(204);
    expect(repo.rows.has(up.body.id)).toBe(false);
    expect(storage.keys()).toHaveLength(0);
  });

  it('repeated deletion is a clean NOT_FOUND', async () => {
    const { service } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    await service.deleteMedia(scope, PRODUCT, up.body.id);
    await expect(service.deleteMedia(scope, PRODUCT, up.body.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a published product image cannot be deleted: unpublish first', async () => {
    const { service, repo } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    repo.productStatusValue = 'PUBLISHED';
    await expect(service.deleteMedia(scope, PRODUCT, up.body.id)).rejects.toMatchObject({
      code: 'MEDIA_ON_PUBLISHED_PRODUCT',
    });
    expect(repo.rows.has(up.body.id)).toBe(true);
  });

  it('failed external delete keeps the object reference in an ORPHANED row', async () => {
    const { service, repo, storage } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    const thumbKey = storage.keys().find((k) => k.includes('/thumb/')) as string;
    storage.failOnDeleteKeys = [thumbKey];
    await service.deleteMedia(scope, PRODUCT, up.body.id);
    expect(repo.rows.has(up.body.id)).toBe(false); // metadata delete stands
    const orphans = [...repo.rows.values()].filter((r) => r.status === 'ORPHANED');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.driveFileKey).toBe(thumbKey);
    expect(await storage.retrieve(thumbKey)).not.toBeNull();
  });
});

describe('MediaService serve', () => {
  it('serves exact variant bytes; guests get public visibility only when published', async () => {
    const { service, repo } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    const draft = await service.serve({ tenantId: TENANT }, PRODUCT, up.body.id, 'thumb');
    expect(draft.visibility).toBe('private'); // product DRAFT: RLS would hide it; service still private
    void draft;
    repo.productStatusValue = 'PUBLISHED';
    const pub = await service.serve({ tenantId: TENANT }, PRODUCT, up.body.id, 'thumb');
    expect(pub.visibility).toBe('public');
    expect(pub.bytes).toEqual(new Uint8Array(100).fill(2));
    expect(pub.contentType).toBe('image/webp');
    const disp = await service.serve({ tenantId: TENANT }, PRODUCT, up.body.id, 'display');
    expect(disp.bytes).toEqual(new Uint8Array(300).fill(3));
  });

  it('never serves non-ACTIVE rows and never a missing object', async () => {
    const { service, repo, storage } = setup();
    const up = await service.upload(scope, PRODUCT, file);
    await repo.setStatus({}, up.body.id, 'ORPHANED');
    await expect(
      service.serve({ tenantId: TENANT }, PRODUCT, up.body.id, 'display'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await repo.setStatus({}, up.body.id, 'ACTIVE');
    for (const k of storage.keys()) await storage.delete(k);
    await expect(
      service.serve({ tenantId: TENANT }, PRODUCT, up.body.id, 'display'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('key convention: variantObjectKey rejects non-UUID parts', () => {
    expect(() => variantObjectKey('x', PRODUCT, 'thumb', PRODUCT)).toThrow(MediaError);
  });
});
