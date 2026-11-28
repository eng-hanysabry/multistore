import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { Cursor } from './public-catalog-rules';

/**
 * Public catalog read models. Deliberately a narrow projection: no tenant_id, created_by,
 * status, updated_at, media or storage fields, so serialization can never leak internal
 * or Drive-related data (8.3, Step 4 leakage requirements).
 */
export interface PublicCategory {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string; // cursor column, serialized shape stays opaque in the cursor
}

export interface PublicProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** Exact decimal text from numeric(14,3); never a JS float. */
  readonly priceAmount: string | null;
  readonly priceCurrency: string | null;
  readonly categoryId: string | null;
  readonly publishedAt: string;
  readonly createdAt: string; // cursor column
  /**
   * Public image URL through the D3 route
   * (`/t/{tenantCode}/products/{productId}/media/{mediaId}/image`), built by the service
   * from the tenant code resolved and validated in the same request context. Points at
   * the first eligible image (deterministic order, see PublicProductRecord) or is null
   * when the product has none. The URL exposes only public path identifiers: never a
   * drive_file_key, storage object key or internal path.
   */
  readonly imageUrl: string | null;
}

/**
 * Internal read record: the public projection minus the derived imageUrl, plus the
 * selected image's media id. The service turns imageMediaId into imageUrl and drops the
 * raw field, so the serialized response can never carry an undecorated internal id.
 * Selection is deterministic and documented: the earliest ACTIVE PRODUCT_IMAGE of the
 * product by (created_at, id); the media RLS policy (media_public_read) restricts
 * GUEST/CUSTOMER to exactly those rows, and the query repeats that filter explicitly.
 */
export interface PublicProductRecord extends Omit<PublicProduct, 'imageUrl'> {
  readonly imageMediaId: string | null;
}

export interface PublicProductQuery {
  readonly q?: string;
  readonly categoryId?: string;
  readonly limit: number;
  readonly cursor?: Cursor;
}

/**
 * Public read port. Every query runs in the caller's transaction under a GUEST or
 * CUSTOMER RLS context: the database policies (categories_public_read,
 * products_public_read) are the security boundary and already restrict to PUBLISHED rows
 * of the resolved tenant with the published-category rule. These queries add only
 * presentation concerns (search text, pagination window).
 */
export interface PublicCatalogRepository {
  listPublishedCategories(tx: TxHandle, limit: number, cursor?: Cursor): Promise<PublicCategory[]>;
  listPublishedProducts(tx: TxHandle, query: PublicProductQuery): Promise<PublicProductRecord[]>;
  findPublishedProduct(tx: TxHandle, id: string): Promise<PublicProductRecord | null>;
}
