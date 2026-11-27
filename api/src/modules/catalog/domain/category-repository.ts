import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { CatalogStatus } from './catalog-rules';

export interface CategoryRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly status: CatalogStatus;
  readonly publishedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Category persistence port. Every method runs inside the caller's tenant transaction:
 * the RLS policies are the real tenant boundary, these queries only shape data (6.3).
 * Tenant scoping is never taken from input; it comes from the RLS context.
 */
export interface CategoryRepository {
  list(tx: TxHandle): Promise<CategoryRecord[]>;
  findById(tx: TxHandle, id: string): Promise<CategoryRecord | null>;
  insert(tx: TxHandle, row: { id: string; name: string; createdBy: string }): Promise<void>;
  updateName(tx: TxHandle, id: string, name: string): Promise<boolean>;
  setStatus(tx: TxHandle, id: string, status: CatalogStatus): Promise<boolean>;
  /** Counts products (any status) referencing the category in this tenant. */
  countProducts(tx: TxHandle, id: string): Promise<number>;
  /** Counts PUBLISHED products referencing the category (M-4 unpublish gate). */
  countPublishedProducts(tx: TxHandle, id: string): Promise<number>;
  deleteById(tx: TxHandle, id: string): Promise<boolean>;
}

export const CATEGORY_REPOSITORY = Symbol('CATEGORY_REPOSITORY');
