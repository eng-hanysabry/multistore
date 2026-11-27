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
  listPublishedProducts(tx: TxHandle, query: PublicProductQuery): Promise<PublicProduct[]>;
  findPublishedProduct(tx: TxHandle, id: string): Promise<PublicProduct | null>;
}
