import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { MediaKind, MediaStatus, VariantsJson } from './media-rules';

/**
 * Media metadata record as the database holds it (camelCase over media_assets columns).
 * driveFileKey and the variant keys are provider references: they exist so the media
 * module can fetch bytes, and they must never appear in an API response (8.3).
 */
export interface MediaRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly productId: string | null;
  readonly kind: MediaKind;
  readonly status: MediaStatus;
  readonly driveFileKey: string | null;
  readonly originalFilename: string | null;
  readonly contentType: string;
  readonly byteSize: number | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly variants: VariantsJson | null;
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewMediaRow {
  readonly id: string;
  readonly productId: string;
  readonly kind: MediaKind;
  readonly status: MediaStatus;
  readonly driveFileKey: string;
  readonly originalFilename: string | null;
  readonly contentType: string;
  readonly byteSize: number | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly variants: VariantsJson | null;
  readonly uploadedBy: string;
}

/**
 * Media persistence port; RLS is the tenant and visibility boundary (media_public_read,
 * media_merchant_*): a MERCHANT context sees and mutates own-tenant rows, GUEST and
 * CUSTOMER contexts only see ACTIVE PRODUCT_IMAGE rows of published products, and a
 * merchant DELETE only passes for logos and media of DRAFT products.
 */
export interface MediaRepository {
  insert(tx: TxHandle, row: NewMediaRow): Promise<void>;
  /** Own-tenant row by id under the current RLS context, or null (same as nonexistent). */
  findById(tx: TxHandle, id: string): Promise<MediaRecord | null>;
  listByProduct(tx: TxHandle, productId: string): Promise<MediaRecord[]>;
  /** Replacement: swaps every object reference to the new generation in one UPDATE. */
  replaceObjects(
    tx: TxHandle,
    id: string,
    next: {
      driveFileKey: string;
      contentType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
      variants: VariantsJson;
    },
  ): Promise<boolean>;
  setStatus(tx: TxHandle, id: string, status: MediaStatus): Promise<boolean>;
  deleteById(tx: TxHandle, id: string): Promise<boolean>;
  /** Status of the owning product inside the current tenant, or null when it does not exist. */
  productStatus(tx: TxHandle, productId: string): Promise<'DRAFT' | 'PUBLISHED' | null>;
}

export const MEDIA_REPOSITORY = Symbol('MEDIA_REPOSITORY');
