import { createHash, randomUUID } from 'node:crypto';
import {
  TenantTransactionRunner,
  TxHandle,
} from '../../../common/tenancy/tenant-transaction-runner';
import { TenantContext } from '../../../common/tenancy/tenant-context';
import { ImageProcessor, ProcessedImage } from '../domain/image-processor';
import { MediaIdempotencyRepository } from '../domain/media-idempotency-repository';
import { MediaError } from '../domain/media-errors';
import { MediaRecord, MediaRepository, NewMediaRow } from '../domain/media-repository';
import {
  IMAGE_VARIANTS,
  ImageVariant,
  MediaStatus,
  VariantMeta,
  VariantsJson,
  WEBP_CONTENT_TYPE,
  assertMediaDeletable,
  assertMediaServable,
  assertOriginalFilename,
  assertUuidParam,
  variantObjectKey,
} from '../domain/media-rules';
import { StorageProvider } from '../domain/storage-provider';

/** Verified caller scope: userId from the token, tenantId from the URL resolution (6.3). */
export interface MerchantScope {
  readonly tenantId: string;
  readonly userId: string;
}

/** Caller scope for image serving: identity only when a token verified (6.3). */
export interface ServingScope {
  readonly tenantId: string;
  readonly userId?: string;
  readonly role?: 'MERCHANT' | 'CUSTOMER' | 'SUPER_ADMIN';
}

export interface UploadedFile {
  readonly bytes: Uint8Array;
  readonly originalFilename?: string;
}

/** What the API may show about a media row: never a storage key or provider field (8.3). */
export interface MediaView {
  readonly id: string;
  readonly productId: string | null;
  readonly kind: MediaRecord['kind'];
  readonly status: MediaStatus;
  readonly contentType: string;
  readonly byteSize: number | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly createdAt: string;
}

export interface MutationResult<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

export interface ServedImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** 'public' only while the owning product is PUBLISHED; drafts are always private. */
  readonly visibility: 'public' | 'private';
}

/** Upper bound on concurrent sharp pipelines per process (8.6.9 memory bound). */
const MAX_CONCURRENT_PROCESSING = 2;

const sha256 = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

const toView = (r: MediaRecord): MediaView => ({
  id: r.id,
  productId: r.productId,
  kind: r.kind,
  status: r.status,
  contentType: r.contentType,
  byteSize: r.byteSize,
  widthPx: r.widthPx,
  heightPx: r.heightPx,
  createdAt: r.createdAt,
});

/**
 * Media use cases (IP-5 Step 6; spec 7, 8.6.9, 10.7; schema design G). StorageProvider
 * owns bytes, the database owns metadata, and the two are never assumed atomic (Batch 3
 * authorization section 10): objects are stored BEFORE the metadata row, an ACTIVE row
 * is only written once every required object exists, external deletes happen only AFTER
 * the database commit, and every object whose cleanup fails is preserved in an ORPHANED
 * row for manual reconciliation (DI-1 stays Deferred: no retry or cleanup job).
 */
export class MediaService {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly media: MediaRepository,
    private readonly idempotency: MediaIdempotencyRepository,
    private readonly storage: StorageProvider,
    private readonly processor: ImageProcessor,
    private readonly ids: () => string = () => randomUUID(),
  ) {}

  private ctx(scope: MerchantScope): TenantContext {
    return { role: 'MERCHANT', tenantId: scope.tenantId, userId: scope.userId };
  }

  /** Bounded sharp concurrency: excess requests wait for a processing slot. */
  private async processBounded(input: Uint8Array): Promise<ProcessedImage> {
    if (this.active >= MAX_CONCURRENT_PROCESSING)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await this.processor.process(input);
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) next();
    }
  }

  private async idempotent<T>(
    scope: MerchantScope,
    action: string,
    key: string | undefined,
    payload: unknown,
    work: (tx: TxHandle) => Promise<MutationResult<T>>,
  ): Promise<MutationResult<T>> {
    if (key === undefined) return this.runner.run(this.ctx(scope), work);
    if (key.length < 1 || key.length > 128) throw new MediaError('VALIDATION');
    const requestHash = sha256(`${action}\n${JSON.stringify(payload)}`);
    const lookup = async (tx: TxHandle): Promise<MutationResult<T> | undefined> => {
      const found = await this.idempotency.find(tx, action, key);
      if (!found) return undefined;
      if (found.requestHash !== requestHash) throw new MediaError('IDEMPOTENCY_CONFLICT');
      return { status: found.responseStatus, body: found.responseBody as T, replayed: true };
    };
    try {
      return await this.runner.run(this.ctx(scope), async (tx) => {
        const replay = await lookup(tx);
        if (replay) return replay;
        const result = await work(tx);
        const inserted = await this.idempotency.insert(tx, {
          id: this.ids(),
          action,
          key,
          requestHash,
          responseStatus: result.status,
          responseBody: result.body ?? null,
        });
        if (!inserted) throw new ConcurrentInsert();
        return result;
      });
    } catch (e) {
      if (!isUniqueViolation(e) && !(e instanceof ConcurrentInsert)) throw e;
      return this.runner.run(this.ctx(scope), async (tx) => {
        const replay = await lookup(tx);
        if (!replay) throw e;
        return replay;
      });
    }
  }

  /** Builds the three keyed variants for a new generation of one asset (G-4). */
  private keyedVariants(
    tenantId: string,
    assetId: string,
    processed: ProcessedImage,
    generation: string,
  ): VariantsJson {
    const meta = (variant: ImageVariant): VariantMeta => ({
      key: variantObjectKey(tenantId, assetId, variant, generation),
      widthPx: processed.variants[variant].widthPx,
      heightPx: processed.variants[variant].heightPx,
      byteSize: processed.variants[variant].byteSize,
    });
    return { original: meta('original'), thumb: meta('thumb'), display: meta('display') };
  }

  /**
   * Stores all three variants. On a partial variant storage failure (section 10) every
   * object already stored is compensated before the safe STORAGE_FAILURE is thrown, so
   * no unreferenced objects are left behind (orphans are recorded by compensate()).
   */
  private async storeVariants(
    scope: MerchantScope,
    productId: string,
    processed: ProcessedImage,
    variants: VariantsJson,
  ): Promise<void> {
    const stored: VariantMeta[] = [];
    try {
      for (const variant of IMAGE_VARIANTS) {
        const m = variants[variant];
        await this.storage.store({
          key: m.key,
          bytes: processed.variants[variant].bytes,
          contentType: WEBP_CONTENT_TYPE,
        });
        stored.push(m);
      }
    } catch {
      await this.compensate(scope, productId, stored);
      throw new MediaError('STORAGE_FAILURE');
    }
  }

  /**
   * Compensation after a partial failure (section 10): delete every object already
   * stored. An object whose delete fails is NOT dropped silently — it is preserved in
   * an ORPHANED row (key retained, no automated cleanup, DI-1 Deferred).
   */
  private async compensate(
    scope: MerchantScope,
    productId: string,
    stored: readonly VariantMeta[],
  ): Promise<void> {
    for (const m of stored) {
      try {
        await this.storage.delete(m.key);
      } catch {
        await this.recordOrphan(scope, productId, m).catch(() => undefined);
      }
    }
  }

  /** Persists a bare object key as an orphan when its dimensions are not recoverable. */
  private async recordOrphanKey(
    scope: MerchantScope,
    productId: string,
    key: string,
  ): Promise<void> {
    await this.recordOrphan(scope, productId, { key, widthPx: 0, heightPx: 0, byteSize: 0 });
  }

  /** Persists one orphaned object reference for the manual reconciliation runbook (G-7). */
  private async recordOrphan(
    scope: MerchantScope,
    productId: string,
    orphan: VariantMeta,
  ): Promise<void> {
    await this.runner.run(this.ctx(scope), async (tx) => {
      const row: NewMediaRow = {
        id: this.ids(),
        productId,
        kind: 'PRODUCT_IMAGE',
        status: 'ORPHANED',
        driveFileKey: orphan.key,
        originalFilename: null,
        contentType: WEBP_CONTENT_TYPE,
        byteSize: orphan.byteSize,
        widthPx: orphan.widthPx > 0 ? orphan.widthPx : null,
        heightPx: orphan.heightPx > 0 ? orphan.heightPx : null,
        variants: null,
        uploadedBy: scope.userId,
      };
      await this.media.insert(tx, row);
    });
  }

  async upload(
    scope: MerchantScope,
    productId: string,
    file: UploadedFile,
    key?: string,
  ): Promise<MutationResult<MediaView>> {
    assertUuidParam(productId);
    const processed = await this.processBounded(file.bytes);
    const assetId = this.ids();
    const variants = this.keyedVariants(scope.tenantId, assetId, processed, this.ids());
    // Objects before metadata: an ACTIVE row never points at missing bytes. A partial
    // store failure is compensated inside storeVariants before STORAGE_FAILURE throws.
    await this.storeVariants(scope, productId, processed, variants);
    try {
      return await this.idempotent(
        scope,
        'media.upload',
        key,
        { productId, bytes: sha256(file.bytes) },
        async (tx) => {
          const status = await this.media.productStatus(tx, productId);
          if (status === null) throw new MediaError('NOT_FOUND');
          await this.media.insert(tx, {
            id: assetId,
            productId,
            kind: 'PRODUCT_IMAGE',
            status: 'ACTIVE',
            driveFileKey: variants.original.key,
            originalFilename: assertOriginalFilename(file.originalFilename),
            contentType: WEBP_CONTENT_TYPE,
            byteSize: variants.original.byteSize,
            widthPx: processed.widthPx,
            heightPx: processed.heightPx,
            variants,
            uploadedBy: scope.userId,
          });
          const record = await this.media.findById(tx, assetId);
          return { status: 201, body: toView(record as MediaRecord), replayed: false };
        },
      );
    } catch (e) {
      // Metadata persistence failed after storage (section 10): compensate the objects;
      // anything that cannot be removed is preserved as an ORPHANED row.
      await this.compensate(scope, productId, Object.values(variants));
      throw e;
    }
  }

  async list(scope: MerchantScope, productId: string): Promise<MediaView[]> {
    assertUuidParam(productId);
    return this.runner.run(this.ctx(scope), async (tx) => {
      const status = await this.media.productStatus(tx, productId);
      if (status === null) throw new MediaError('NOT_FOUND');
      return (await this.media.listByProduct(tx, productId)).map(toView);
    });
  }

  async replace(
    scope: MerchantScope,
    productId: string,
    mediaId: string,
    file: UploadedFile,
  ): Promise<MediaView> {
    assertUuidParam(productId);
    assertUuidParam(mediaId);
    const processed = await this.processBounded(file.bytes);
    const variants = this.keyedVariants(scope.tenantId, mediaId, processed, this.ids());
    let oldKeys: string[] = [];
    // Partial store failure: compensated inside storeVariants, new generation removed.
    await this.storeVariants(scope, productId, processed, variants);
    let view: MediaView;
    try {
      view = await this.runner.run(this.ctx(scope), async (tx) => {
        const record = await this.media.findById(tx, mediaId);
        if (!record || record.productId !== productId || record.kind !== 'PRODUCT_IMAGE')
          throw new MediaError('NOT_FOUND');
        oldKeys = keysOf(record);
        const ok = await this.media.replaceObjects(tx, mediaId, {
          driveFileKey: variants.original.key,
          contentType: WEBP_CONTENT_TYPE,
          byteSize: variants.original.byteSize,
          widthPx: processed.widthPx,
          heightPx: processed.heightPx,
          variants,
        });
        if (!ok) throw new MediaError('NOT_FOUND');
        return toView((await this.media.findById(tx, mediaId)) as MediaRecord);
      });
    } catch (e) {
      // New objects stored but the swap failed: remove the new generation, keep the old.
      await this.compensate(scope, productId, Object.values(variants));
      throw e;
    }
    // G-4: old external objects are deleted only after the database commit. A failed
    // delete preserves the old reference in an ORPHANED row; the replacement stands.
    for (const oldKey of oldKeys) {
      try {
        await this.storage.delete(oldKey);
      } catch {
        await this.recordOrphan(scope, productId, {
          key: oldKey,
          widthPx: view.widthPx ?? 0,
          heightPx: view.heightPx ?? 0,
          byteSize: 0,
        }).catch(() => undefined);
      }
    }
    return view;
  }

  async deleteMedia(
    scope: MerchantScope,
    productId: string,
    mediaId: string,
    key?: string,
  ): Promise<MutationResult<null>> {
    assertUuidParam(productId);
    assertUuidParam(mediaId);
    let removed: string[] = [];
    const result = await this.idempotent(
      scope,
      'media.delete',
      key,
      { productId, mediaId },
      async (tx) => {
        const record = await this.media.findById(tx, mediaId);
        if (!record || record.productId !== productId || record.kind !== 'PRODUCT_IMAGE')
          throw new MediaError('NOT_FOUND');
        const productStatus = await this.media.productStatus(tx, productId);
        if (productStatus === null) throw new MediaError('NOT_FOUND');
        assertMediaDeletable(productStatus);
        removed = keysOf(record);
        const ok = await this.media.deleteById(tx, mediaId);
        if (!ok) throw new MediaError('NOT_FOUND');
        return { status: 204, body: null, replayed: false };
      },
    );
    if (!result.replayed) {
      // External cleanup after the commit (G-4). A failed delete keeps the object
      // reference in an ORPHANED row — metadata is never silently dropped (section 10).
      for (const oldKey of removed) {
        try {
          await this.storage.delete(oldKey);
        } catch {
          await this.recordOrphanKey(scope, productId, oldKey).catch(() => undefined);
        }
      }
    }
    return result;
  }

  /**
   * Authorized image serving (spec 7, 8.6.9): the read runs under the caller's own RLS
   * context, so the database itself decides visibility — GUEST/CUSTOMER see only ACTIVE
   * images of published products (media_public_read), a merchant member of the URL
   * tenant sees drafts. The tenant, the product and the row all come from the URL and
   * the verified token, never from request input.
   */
  async serve(
    scope: ServingScope,
    productId: string,
    mediaId: string,
    variant: ImageVariant,
  ): Promise<ServedImage> {
    assertUuidParam(productId);
    assertUuidParam(mediaId);
    const ctx: TenantContext =
      scope.role === 'MERCHANT'
        ? { role: 'MERCHANT', tenantId: scope.tenantId, userId: scope.userId }
        : scope.userId !== undefined
          ? { role: 'CUSTOMER', tenantId: scope.tenantId, userId: scope.userId }
          : { role: 'GUEST', tenantId: scope.tenantId };
    const found = await this.runner.run(ctx, async (tx) => {
      const record = await this.media.findById(tx, mediaId);
      if (!record || record.productId !== productId || record.kind !== 'PRODUCT_IMAGE') return null;
      assertMediaServable(record.status);
      const status = await this.media.productStatus(tx, productId);
      return { record, productStatus: status };
    });
    if (!found) throw new MediaError('NOT_FOUND');
    const meta =
      variant === 'original' ? found.record.variants?.original : found.record.variants?.[variant];
    const key = meta?.key ?? found.record.driveFileKey;
    if (!key) throw new MediaError('NOT_FOUND');
    const object = await this.storage.retrieve(key);
    if (!object) throw new MediaError('NOT_FOUND');
    return {
      bytes: object.bytes,
      contentType: object.contentType,
      visibility: found.productStatus === 'PUBLISHED' ? 'public' : 'private',
    };
  }
}

/** Every external object key a row points at (original plus derived variants). */
function keysOf(record: MediaRecord): string[] {
  const keys: string[] = [];
  if (record.variants) {
    for (const v of IMAGE_VARIANTS) {
      const k = record.variants[v]?.key;
      if (k) keys.push(k);
    }
  }
  if (record.driveFileKey && !keys.includes(record.driveFileKey)) keys.push(record.driveFileKey);
  return keys;
}

/** Internal control-flow marker: idempotency insert lost the unique race. */
class ConcurrentInsert extends Error {}
