import { createHash, randomUUID } from 'node:crypto';
import {
  TenantTransactionRunner,
  TxHandle,
} from '../../../common/tenancy/tenant-transaction-runner';
import { TenantContext } from '../../../common/tenancy/tenant-context';
import { CatalogError } from '../domain/catalog-errors';
import {
  assertCategoryDeletable,
  assertCategoryName,
  assertCategoryUnpublishable,
  assertIdempotencyKey,
  assertProductDeletable,
  assertProductDraft,
  assertProductFields,
  assertProductPublishable,
  assertProductUnpublishable,
  assertPublishableCategory,
  assertValidPrice,
} from '../domain/catalog-rules';
import { CategoryRecord, CategoryRepository } from '../domain/category-repository';
import {
  ProductInput,
  ProductPatch,
  ProductRecord,
  ProductRepository,
} from '../domain/product-repository';
import { IdempotencyRepository } from '../domain/idempotency-repository';

/** Verified caller scope: userId from the token, tenantId from the URL resolution (6.3). */
export interface MerchantScope {
  readonly tenantId: string;
  readonly userId: string;
}

export interface MutationResult<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
};
const hashRequest = (action: string, payload: unknown): string =>
  createHash('sha256')
    .update(`${action}\n${canonical(payload)}`)
    .digest('hex');

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: string; message?: string }).code === '23505';

/**
 * Merchant Catalog Core (IP-5 Step 3). One use case per merchant operation; every one
 * runs through the TenantRunner so RLS context and queries share one transaction (6.3).
 * Idempotency (10.7) covers the creating POSTs and the publish operations: category
 * create, product create, category publish, product publish.
 */
export class CatalogService {
  constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly categories: CategoryRepository,
    private readonly products: ProductRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly ids: () => string = () => randomUUID(),
  ) {}

  private ctx(scope: MerchantScope): TenantContext {
    return { role: 'MERCHANT', tenantId: scope.tenantId, userId: scope.userId };
  }

  /**
   * Runs work under the idempotency contract. No key: execute directly. With a key:
   * replay returns the stored result, a hash mismatch is a conflict, and a concurrent
   * duplicate loses the unique race, then reads the winner's record in a fresh
   * transaction (the mutation itself executed exactly once).
   */
  private async idempotent<T>(
    scope: MerchantScope,
    action: string,
    key: string | undefined,
    payload: unknown,
    work: (tx: TxHandle) => Promise<MutationResult<T>>,
  ): Promise<MutationResult<T>> {
    if (key === undefined) {
      return this.runner.run(this.ctx(scope), work);
    }
    assertIdempotencyKey(key);
    const requestHash = hashRequest(action, payload);
    const lookup = async (tx: TxHandle): Promise<MutationResult<T> | undefined> => {
      const found = await this.idempotency.find(tx, action, key);
      if (!found) return undefined;
      if (found.requestHash !== requestHash) throw new CatalogError('IDEMPOTENCY_CONFLICT');
      return {
        status: found.responseStatus,
        body: found.responseBody as T,
        replayed: true,
      };
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
          responseBody: result.body as unknown,
        });
        if (!inserted) throw new ConcurrentInsert();
        return result;
      });
    } catch (e) {
      if (!isUniqueViolation(e) && !(e instanceof ConcurrentInsert)) throw e;
      // Lost the unique race: the winner's commit holds the record and the result.
      return this.runner.run(this.ctx(scope), async (tx) => {
        const replay = await lookup(tx);
        if (!replay) throw e;
        return replay;
      });
    }
  }

  // ---- Categories ----

  async createCategory(
    scope: MerchantScope,
    input: { name: string },
    key?: string,
  ): Promise<MutationResult<CategoryRecord>> {
    assertCategoryName(input.name);
    return this.idempotent(scope, 'category.create', key, input, async (tx) => {
      const id = this.ids();
      await this.categories.insert(tx, { id, name: input.name, createdBy: scope.userId });
      const record = await this.categories.findById(tx, id);
      return { status: 201, body: record as CategoryRecord, replayed: false };
    });
  }

  listCategories(scope: MerchantScope): Promise<CategoryRecord[]> {
    return this.runner.run(this.ctx(scope), (tx) => this.categories.list(tx));
  }

  async getCategory(scope: MerchantScope, id: string): Promise<CategoryRecord> {
    const record = await this.runner.run(this.ctx(scope), (tx) => this.categories.findById(tx, id));
    if (!record) throw new CatalogError('NOT_FOUND');
    return record;
  }

  async updateCategory(
    scope: MerchantScope,
    id: string,
    input: { name: string },
  ): Promise<CategoryRecord> {
    assertCategoryName(input.name);
    return this.runner.run(this.ctx(scope), async (tx) => {
      const record = await this.categories.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      await this.categories.updateName(tx, id, input.name);
      return (await this.categories.findById(tx, id)) as CategoryRecord;
    });
  }

  async publishCategory(
    scope: MerchantScope,
    id: string,
    key?: string,
  ): Promise<MutationResult<CategoryRecord>> {
    return this.idempotent(scope, 'category.publish', key, { id }, async (tx) => {
      const record = await this.categories.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      assertPublishableCategory(record.status);
      await this.categories.setStatus(tx, id, 'PUBLISHED');
      return {
        status: 200,
        body: (await this.categories.findById(tx, id)) as CategoryRecord,
        replayed: false,
      };
    });
  }

  async unpublishCategory(scope: MerchantScope, id: string): Promise<CategoryRecord> {
    return this.runner.run(this.ctx(scope), async (tx) => {
      const record = await this.categories.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      assertCategoryUnpublishable(
        record.status,
        await this.categories.countPublishedProducts(tx, id),
      );
      await this.categories.setStatus(tx, id, 'DRAFT');
      return (await this.categories.findById(tx, id)) as CategoryRecord;
    });
  }

  async deleteCategory(scope: MerchantScope, id: string): Promise<void> {
    return this.runner.run(this.ctx(scope), async (tx) => {
      const record = await this.categories.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      assertCategoryDeletable(record.status, await this.categories.countProducts(tx, id));
      await this.categories.deleteById(tx, id);
    });
  }

  // ---- Products ----

  async createProduct(
    scope: MerchantScope,
    input: ProductInput,
    key?: string,
  ): Promise<MutationResult<ProductRecord>> {
    assertProductFields(input);
    assertValidPrice(input);
    return this.idempotent(scope, 'product.create', key, input, async (tx) => {
      if (input.categoryId != null) {
        const status = await this.products.categoryStatus(tx, input.categoryId);
        if (status === null) throw new CatalogError('NOT_FOUND');
      }
      const id = this.ids();
      await this.products.insert(tx, { id, createdBy: scope.userId, ...input });
      return {
        status: 201,
        body: (await this.products.findById(tx, id)) as ProductRecord,
        replayed: false,
      };
    });
  }

  listProducts(scope: MerchantScope): Promise<ProductRecord[]> {
    return this.runner.run(this.ctx(scope), (tx) => this.products.list(tx));
  }

  async getProduct(scope: MerchantScope, id: string): Promise<ProductRecord> {
    const record = await this.runner.run(this.ctx(scope), (tx) => this.products.findById(tx, id));
    if (!record) throw new CatalogError('NOT_FOUND');
    return record;
  }

  /** Draft updates only; status is server-controlled and never comes from the DTO. */
  async updateProduct(
    scope: MerchantScope,
    id: string,
    input: ProductPatch,
  ): Promise<ProductRecord> {
    if (input.name !== undefined) assertProductFields({ name: input.name });
    if (input.description !== undefined && input.description !== null)
      assertProductFields({ name: 'check', description: input.description });
    return this.runner.run(this.ctx(scope), async (tx) => {
      const record = await this.products.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      assertProductDraft(record.status);
      if (input.categoryId != null) {
        const status = await this.products.categoryStatus(tx, input.categoryId);
        if (status === null) throw new CatalogError('NOT_FOUND');
      }
      // Price pair must stay consistent against the stored row when only one side changes.
      const merged = {
        priceAmount:
          input.priceAmount !== undefined
            ? input.priceAmount
            : record.priceAmount === null
              ? null
              : Number(record.priceAmount),
        priceCurrency:
          input.priceCurrency !== undefined ? input.priceCurrency : record.priceCurrency,
      };
      assertValidPrice(merged);
      await this.products.updateDraft(tx, id, input);
      return (await this.products.findById(tx, id)) as ProductRecord;
    });
  }

  async publishProduct(
    scope: MerchantScope,
    id: string,
    key?: string,
  ): Promise<MutationResult<ProductRecord>> {
    return this.idempotent(scope, 'product.publish', key, { id }, async (tx) => {
      const record = await this.products.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      const categoryPublished = record.categoryId
        ? (await this.products.categoryStatus(tx, record.categoryId)) === 'PUBLISHED'
        : null;
      assertProductPublishable({
        status: record.status,
        categoryPublished,
        activeImages: await this.products.countActiveImages(tx, id),
      });
      await this.products.setStatus(tx, id, 'PUBLISHED');
      return {
        status: 200,
        body: (await this.products.findById(tx, id)) as ProductRecord,
        replayed: false,
      };
    });
  }

  async unpublishProduct(scope: MerchantScope, id: string): Promise<ProductRecord> {
    return this.runner.run(this.ctx(scope), async (tx) => {
      const record = await this.products.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      assertProductUnpublishable(record.status);
      await this.products.setStatus(tx, id, 'DRAFT');
      return (await this.products.findById(tx, id)) as ProductRecord;
    });
  }

  async deleteProduct(scope: MerchantScope, id: string): Promise<void> {
    return this.runner.run(this.ctx(scope), async (tx) => {
      const record = await this.products.findById(tx, id);
      if (!record) throw new CatalogError('NOT_FOUND');
      assertProductDeletable(record.status, await this.products.countMedia(tx, id));
      await this.products.deleteById(tx, id);
    });
  }
}

/** Internal control-flow marker: idempotency insert lost the unique race. */
class ConcurrentInsert extends Error {}
