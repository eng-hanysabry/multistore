import { TxHandle } from '../../src/common/tenancy/tenant-transaction-runner';
import {
  CatalogService,
  MerchantScope,
} from '../../src/modules/catalog/application/catalog-service';
import { CatalogStatus } from '../../src/modules/catalog/domain/catalog-rules';
import {
  CategoryRecord,
  CategoryRepository,
} from '../../src/modules/catalog/domain/category-repository';
import {
  ProductInput,
  ProductPatch,
  ProductRecord,
  ProductRepository,
} from '../../src/modules/catalog/domain/product-repository';
import {
  IdempotencyRecord,
  IdempotencyRepository,
} from '../../src/modules/catalog/domain/idempotency-repository';

type Mut<T> = { -readonly [K in keyof T]: T[K] };

const TX: TxHandle = {};
const runner = {
  run: <T>(_ctx: unknown, work: (tx: TxHandle) => Promise<T>): Promise<T> => work(TX),
};
const SCOPE: MerchantScope = { tenantId: 't-1', userId: 'u-1' };

const NOW = '2026-11-27 00:00:00+00';

class FakeCategories implements CategoryRepository {
  rows = new Map<string, Mut<CategoryRecord>>();
  publishedProducts = 0;
  inserts = 0;

  list(): Promise<CategoryRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }
  findById(_tx: TxHandle, id: string): Promise<CategoryRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  insert(_tx: TxHandle, row: { id: string; name: string; createdBy: string }): Promise<void> {
    this.inserts += 1;
    this.rows.set(row.id, {
      id: row.id,
      tenantId: SCOPE.tenantId,
      name: row.name,
      status: 'DRAFT',
      publishedAt: null,
      createdBy: row.createdBy,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return Promise.resolve();
  }
  updateName(_tx: TxHandle, id: string, name: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return Promise.resolve(false);
    r.name = name;
    return Promise.resolve(true);
  }
  setStatus(_tx: TxHandle, id: string, status: CatalogStatus): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return Promise.resolve(false);
    r.status = status;
    r.publishedAt = status === 'PUBLISHED' ? NOW : null;
    return Promise.resolve(true);
  }
  countProducts(): Promise<number> {
    return Promise.resolve(0);
  }
  countPublishedProducts(): Promise<number> {
    return Promise.resolve(this.publishedProducts);
  }
  deleteById(_tx: TxHandle, id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }
}

class FakeProducts implements ProductRepository {
  rows = new Map<string, Mut<ProductRecord>>();
  categoryStatuses = new Map<string, CatalogStatus>();
  activeImages = 0;
  productCount = 0;
  updates: ProductPatch[] = [];

  list(): Promise<ProductRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }
  findById(_tx: TxHandle, id: string): Promise<ProductRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  categoryStatus(_tx: TxHandle, categoryId: string): Promise<CatalogStatus | null> {
    return Promise.resolve(this.categoryStatuses.get(categoryId) ?? null);
  }
  countActiveImages(): Promise<number> {
    return Promise.resolve(this.activeImages);
  }
  countMedia(): Promise<number> {
    return Promise.resolve(this.activeImages);
  }
  insert(_tx: TxHandle, row: { id: string; createdBy: string } & ProductInput): Promise<void> {
    this.rows.set(row.id, {
      id: row.id,
      tenantId: SCOPE.tenantId,
      categoryId: row.categoryId ?? null,
      name: row.name,
      description: row.description ?? null,
      priceAmount:
        row.priceAmount === undefined || row.priceAmount === null ? null : String(row.priceAmount),
      priceCurrency: row.priceCurrency ?? null,
      status: 'DRAFT',
      publishedAt: null,
      createdBy: row.createdBy,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return Promise.resolve();
  }
  updateDraft(_tx: TxHandle, id: string, fields: ProductPatch): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return Promise.resolve(false);
    this.updates.push(fields);
    if (fields.name !== undefined) r.name = fields.name;
    if (fields.description !== undefined) r.description = fields.description;
    if (fields.categoryId !== undefined) r.categoryId = fields.categoryId;
    if (fields.priceAmount !== undefined)
      r.priceAmount = fields.priceAmount === null ? null : String(fields.priceAmount);
    if (fields.priceCurrency !== undefined) r.priceCurrency = fields.priceCurrency;
    return Promise.resolve(true);
  }
  setStatus(_tx: TxHandle, id: string, status: CatalogStatus): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r) return Promise.resolve(false);
    r.status = status;
    return Promise.resolve(true);
  }
  deleteById(_tx: TxHandle, id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }
}

class FakeIdempotency implements IdempotencyRepository {
  rows = new Map<string, Mut<IdempotencyRecord>>();
  failNextInsert = false;
  missNextFind = false;

  find(_tx: TxHandle, action: string, key: string): Promise<IdempotencyRecord | null> {
    if (this.missNextFind) {
      this.missNextFind = false;
      return Promise.resolve(null);
    }
    return Promise.resolve(this.rows.get(`${action}:${key}`) ?? null);
  }
  insert(
    _tx: TxHandle,
    row: {
      id: string;
      action: string;
      key: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
    },
  ): Promise<boolean> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      return Promise.resolve(false);
    }
    this.rows.set(`${row.action}:${row.key}`, {
      id: row.id,
      tenantId: SCOPE.tenantId,
      userId: SCOPE.userId,
      action: row.action,
      key: row.key,
      requestHash: row.requestHash,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
      createdAt: NOW,
      expiresAt: NOW,
    });
    return Promise.resolve(true);
  }
}

const setup = () => {
  const categories = new FakeCategories();
  const products = new FakeProducts();
  const idempotency = new FakeIdempotency();
  let seq = 0;
  const service = new CatalogService(
    runner,
    categories,
    products,
    idempotency,
    () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  );
  return { service, categories, products, idempotency };
};

const expectCode = async (p: Promise<unknown>, c: string): Promise<void> => {
  await expect(p).rejects.toMatchObject({ code: c });
};

describe('CatalogService categories', () => {
  it('creates a draft category stamped with the caller, server id and 201', async () => {
    const { service, categories } = setup();
    const r = await service.createCategory(SCOPE, { name: 'Shoes' });
    expect(r.status).toBe(201);
    expect(r.replayed).toBe(false);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.createdBy).toBe('u-1');
    expect(categories.rows.size).toBe(1);
  });

  it('idempotent replay returns the stored first result without re-inserting', async () => {
    const { service, categories } = setup();
    const first = await service.createCategory(SCOPE, { name: 'Shoes' }, 'k-1');
    const replay = await service.createCategory(SCOPE, { name: 'Shoes' }, 'k-1');
    expect(replay.replayed).toBe(true);
    expect(replay.body.id).toBe(first.body.id);
    expect(categories.inserts).toBe(1);
  });

  it('same key with a different body is IDEMPOTENCY_CONFLICT', async () => {
    const { service } = setup();
    await service.createCategory(SCOPE, { name: 'Shoes' }, 'k-1');
    await expectCode(
      service.createCategory(SCOPE, { name: 'Bags' }, 'k-1'),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('losing the unique race re-reads the winner record', async () => {
    const { service, categories, idempotency } = setup();
    // Simulate a concurrent winner: the loser's pre-check misses (race window), its
    // insert hits the unique index, and the re-read finds the winner's stored record.
    const first = await service.createCategory(SCOPE, { name: 'Shoes' }, 'k-race');
    idempotency.missNextFind = true;
    idempotency.failNextInsert = true;
    const loser = await service.createCategory(SCOPE, { name: 'Shoes' }, 'k-race');
    expect(loser.replayed).toBe(true);
    expect(loser.body.id).toBe(first.body.id);
    expect(categories.inserts).toBe(2); // the losing attempt rolled back in a real DB
  });

  it('publish only from DRAFT; unpublish blocked with published products (M-4)', async () => {
    const { service, categories } = setup();
    const created = await service.createCategory(SCOPE, { name: 'Shoes' });
    const id = created.body.id;
    const published = await service.publishCategory(SCOPE, id, 'pub-1');
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.publishedAt).not.toBeNull();
    await expectCode(service.publishCategory(SCOPE, id), 'INVALID_STATE');
    categories.publishedProducts = 1;
    await expectCode(service.unpublishCategory(SCOPE, id), 'CATEGORY_HAS_PUBLISHED_PRODUCTS');
    categories.publishedProducts = 0;
    const back = await service.unpublishCategory(SCOPE, id);
    expect(back.status).toBe('DRAFT');
    expect(back.publishedAt).toBeNull();
  });

  it('delete only when DRAFT and unreferenced; rename works', async () => {
    const { service, categories } = setup();
    const id = (await service.createCategory(SCOPE, { name: 'Shoes' })).body.id;
    const renamed = await service.updateCategory(SCOPE, id, { name: 'Sneakers' });
    expect(renamed.name).toBe('Sneakers');
    await service.publishCategory(SCOPE, id);
    await expectCode(service.deleteCategory(SCOPE, id), 'INVALID_STATE');
    await service.unpublishCategory(SCOPE, id);
    categories.countProducts = () => Promise.resolve(1);
    await expectCode(service.deleteCategory(SCOPE, id), 'CATEGORY_IN_USE');
    categories.countProducts = () => Promise.resolve(0);
    await service.deleteCategory(SCOPE, id);
    expect(categories.rows.size).toBe(0);
  });

  it('unknown category is NOT_FOUND without leaking anything', async () => {
    const { service } = setup();
    await expectCode(service.getCategory(SCOPE, 'nope'), 'NOT_FOUND');
    await expectCode(service.updateCategory(SCOPE, 'nope', { name: 'x' }), 'NOT_FOUND');
    await expectCode(service.deleteCategory(SCOPE, 'nope'), 'NOT_FOUND');
  });
});

describe('CatalogService products', () => {
  it('creates a draft product; missing category is NOT_FOUND', async () => {
    const { service, products } = setup();
    products.categoryStatuses.set('cat-1', 'PUBLISHED');
    const r = await service.createProduct(SCOPE, {
      name: 'Sneaker',
      categoryId: 'cat-1',
      priceAmount: 199.5,
      priceCurrency: 'EGP',
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.priceAmount).toBe('199.5');
    await expectCode(service.createProduct(SCOPE, { name: 'X', categoryId: 'ghost' }), 'NOT_FOUND');
  });

  it('rejects half price pairs and bad currency at the service boundary (M-1)', async () => {
    const { service } = setup();
    await expectCode(service.createProduct(SCOPE, { name: 'X', priceAmount: 10 }), 'VALIDATION');
    await expectCode(
      service.createProduct(SCOPE, { name: 'X', priceCurrency: 'EGP' }),
      'VALIDATION',
    );
    await expectCode(
      service.createProduct(SCOPE, { name: 'X', priceAmount: -1, priceCurrency: 'EGP' }),
      'VALIDATION',
    );
  });

  it('updates drafts only and keeps the stored price pair consistent', async () => {
    const { service, products } = setup();
    const id = (
      await service.createProduct(SCOPE, {
        name: 'Sneaker',
        priceAmount: 100,
        priceCurrency: 'EGP',
      })
    ).body.id;
    // amount-only update keeps the stored currency: valid
    const updated = await service.updateProduct(SCOPE, id, { priceAmount: 250 });
    expect(updated.priceAmount).toBe('250');
    expect(updated.priceCurrency).toBe('EGP');
    // clearing only the currency would leave amount without currency: rejected
    await expectCode(service.updateProduct(SCOPE, id, { priceCurrency: null }), 'VALIDATION');
    // published products cannot be edited (J9)
    products.activeImages = 1;
    await service.publishProduct(SCOPE, id);
    await expectCode(service.updateProduct(SCOPE, id, { name: 'New' }), 'INVALID_STATE');
    await expectCode(service.deleteProduct(SCOPE, id), 'INVALID_STATE');
  });

  it('publish gate: DRAFT, published category, ACTIVE image (8.7, M-3)', async () => {
    const { service, products } = setup();
    products.categoryStatuses.set('cat-draft', 'DRAFT');
    products.categoryStatuses.set('cat-pub', 'PUBLISHED');

    const noImg = (await service.createProduct(SCOPE, { name: 'A' })).body.id;
    await expectCode(service.publishProduct(SCOPE, noImg), 'IMAGE_REQUIRED');

    const draftCat = (await service.createProduct(SCOPE, { name: 'B', categoryId: 'cat-draft' }))
      .body.id;
    products.activeImages = 1;
    await expectCode(service.publishProduct(SCOPE, draftCat), 'CATEGORY_NOT_PUBLISHED');

    const ok = (await service.createProduct(SCOPE, { name: 'C', categoryId: 'cat-pub' })).body.id;
    const published = await service.publishProduct(SCOPE, ok, 'pk-1');
    expect(published.body.status).toBe('PUBLISHED');
    // idempotent replay of the publish
    const replay = await service.publishProduct(SCOPE, ok, 'pk-1');
    expect(replay.replayed).toBe(true);
    // without a key, re-publish is INVALID_STATE
    await expectCode(service.publishProduct(SCOPE, ok), 'INVALID_STATE');

    const back = await service.unpublishProduct(SCOPE, ok);
    expect(back.status).toBe('DRAFT');
    // media references block deletion until the media lifecycle removes them
    await expectCode(service.deleteProduct(SCOPE, ok), 'PRODUCT_HAS_MEDIA');
    products.activeImages = 0;
    await service.deleteProduct(SCOPE, ok);
    expect(products.rows.has(ok)).toBe(false);
  });
});
