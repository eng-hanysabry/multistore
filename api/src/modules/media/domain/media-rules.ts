import { MediaError } from './media-errors';

/**
 * Image and media lifecycle rules (IP-5 Step 6; approved J10 limits and the Batch 1
 * schema design G.3/G.4). Pure functions: no framework, no database, no sharp (5.3).
 * The image processor port decodes; these rules decide what is acceptable.
 */

export type MediaKind = 'PRODUCT_IMAGE' | 'STORE_LOGO';
export type MediaStatus = 'UPLOADING' | 'ACTIVE' | 'FAILED' | 'ORPHANED';
export type ImageVariant = 'original' | 'thumb' | 'display';
export const IMAGE_VARIANTS: readonly ImageVariant[] = ['original', 'thumb', 'display'];

/** J10: intake 5 MB, decoded dimension cap 4000 px, thumb 256 px, display 1024 px, WebP out. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DIMENSION_PX = 4000;
export const THUMB_PX = 256;
export const DISPLAY_PX = 1024;
export const WEBP_CONTENT_TYPE = 'image/webp';

/**
 * Decoded input formats the media pipeline accepts. The approved specification names no
 * input list (only WebP output, J10), so the pipeline takes the minimal common raster
 * set sharp decodes natively. SVG is deliberately excluded: it is markup, not a raster
 * image, and rasterizing attacker-controlled SVG is an XSS/payload vector (8.6.9).
 * The format is always the sniffed one from the decoded bytes, never the client header.
 */
export const SUPPORTED_INPUT_FORMATS: readonly string[] = ['jpeg', 'png', 'webp'];

export const ORIGINAL_FILENAME_MAX = 255;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** STM-21: a non-UUID path id can never name a row; same NOT_FOUND as a nonexistent id. */
export function assertUuidParam(id: string): void {
  if (!UUID.test(id)) throw new MediaError('NOT_FOUND');
}

/** J10: the 5 MB intake cap is enforced before any processing happens. */
export function assertUploadSize(byteLength: number): void {
  if (byteLength === 0) throw new MediaError('INVALID_IMAGE');
  if (byteLength > MAX_UPLOAD_BYTES) throw new MediaError('PAYLOAD_TOO_LARGE');
}

/** J10: dimensions are enforced after decoding, on the orientation-corrected size. */
export function assertDimensions(widthPx: number, heightPx: number): void {
  if (
    !Number.isInteger(widthPx) ||
    !Number.isInteger(heightPx) ||
    widthPx < 1 ||
    heightPx < 1 ||
    widthPx > MAX_DIMENSION_PX ||
    heightPx > MAX_DIMENSION_PX
  )
    throw new MediaError('DIMENSIONS_TOO_LARGE');
}

/** The sniffed format must be in the approved input set; anything else is rejected. */
export function assertSupportedFormat(format: string | undefined): void {
  if (format === undefined || !SUPPORTED_INPUT_FORMATS.includes(format))
    throw new MediaError('UNSUPPORTED_MEDIA_TYPE');
}

/**
 * Object keys (G.3/G.4): media/{tenantId}/{assetId}/{variant}/{generation}.
 * No .webp suffix: the accepted Step 5 port forbids dots in keys (assertObjectKey); the
 * variant path segment conveys the role and content_type stores image/webp.
 * The per-generation UUID segment is what makes replacement create NEW keys (G-4): a
 * replaced variant never reuses the old object identity, so a cached representation can
 * never serve the old image under the new variant identity. Original client filenames
 * are metadata only and never appear in a key.
 */
export function variantObjectKey(
  tenantId: string,
  assetId: string,
  variant: ImageVariant,
  generation: string,
): string {
  if (!UUID.test(tenantId) || !UUID.test(assetId) || !UUID.test(generation))
    throw new MediaError('VALIDATION');
  return `media/${tenantId}/${assetId}/${variant}/${generation}`;
}

export interface VariantMeta {
  readonly key: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteSize: number;
}

/**
 * Shape persisted in media_assets.variants (Batch 1 design C.3): per-variant object
 * metadata. The original's key also lives in drive_file_key (the provider-neutral
 * primary reference); thumb/display keys live only here.
 */
export interface VariantsJson {
  readonly original: VariantMeta;
  readonly thumb: VariantMeta;
  readonly display: VariantMeta;
}

/**
 * Media delete lifecycle (spec 8.6.9, RLS media_merchant_delete): images of a PUBLISHED
 * product are locked. Deleting one would silently break the approved publish rule (a
 * published product needs at least one ACTIVE image), so the merchant unpublishes first
 * — the behavior the Batch 3 authorization section 9 names explicitly.
 */
export function assertMediaDeletable(productStatus: 'DRAFT' | 'PUBLISHED'): void {
  if (productStatus !== 'DRAFT') throw new MediaError('MEDIA_ON_PUBLISHED_PRODUCT');
}

/** Only ACTIVE rows serve bytes: UPLOADING/FAILED/ORPHANED have no guaranteed objects. */
export function assertMediaServable(status: MediaStatus): void {
  if (status !== 'ACTIVE') throw new MediaError('NOT_FOUND');
}

export function assertOriginalFilename(name: string | undefined): string | null {
  if (name === undefined) return null;
  // Metadata only; never used as a key or path. Length-capped like any stored text.
  return name.slice(0, ORIGINAL_FILENAME_MAX);
}
