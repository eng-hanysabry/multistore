import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { CatalogStatus } from './catalog-rules';

export interface ProductRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly description: string | null;
  /** Exact decimal text as read from numeric(14,3); never a JS float. */
  readonly priceAmount: string | null;
  readonly priceCurrency: string | null;
  readonly status: CatalogStatus;
  readonly publishedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductInput {
  readonly name: string;
  readonly description?: string | null;
  readonly categoryId?: string | null;
  readonly priceAmount?: number | null;
  readonly priceCurrency?: string | null;
}

/** Partial update shape; only provided fields change. */
export type ProductPatch = Partial<ProductInput>;

/** Product persistence port; RLS is the tenant boundary (see CategoryRepository). */
export interface ProductRepository {
  list(tx: TxHandle): Promise<ProductRecord[]>;
  findById(tx: TxHandle, id: string): Promise<ProductRecord | null>;
  /** Status of the category inside the current tenant, or null when it does not exist. */
  categoryStatus(tx: TxHandle, categoryId: string): Promise<CatalogStatus | null>;
  /** ACTIVE PRODUCT_IMAGE count (8.7 publish gate). */
  countActiveImages(tx: TxHandle, productId: string): Promise<number>;
  /** All media assets referencing the product (delete guard; FK is ON DELETE RESTRICT). */
  countMedia(tx: TxHandle, productId: string): Promise<number>;
  insert(tx: TxHandle, row: { id: string; createdBy: string } & ProductInput): Promise<void>;
  updateDraft(tx: TxHandle, id: string, fields: ProductPatch): Promise<boolean>;
  setStatus(tx: TxHandle, id: string, status: CatalogStatus): Promise<boolean>;
  deleteById(tx: TxHandle, id: string): Promise<boolean>;
}

export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');
