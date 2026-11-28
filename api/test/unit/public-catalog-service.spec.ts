import { TxHandle } from '../../src/common/tenancy/tenant-transaction-runner';
import { TenantContext } from '../../src/common/tenancy/tenant-context';
import {
  PublicCatalogService,
  PublicScope,
} from '../../src/modules/catalog/application/public-catalog-service';
import {
  PublicCatalogRepository,
  PublicCategory,
  PublicProductQuery,
  PublicProductRecord,
} from '../../src/modules/catalog/domain/public-catalog-repository';
import {
  Cursor,
  decodeCursor,
  encodeCursor,
} from '../../src/modules/catalog/domain/public-catalog-rules';

const TX: TxHandle = {};

const GUEST: PublicScope = { tenantId: 't-1', tenantCode: 'store-a' };
const SIGNED: PublicScope = { tenantId: 't-1', tenantCode: 'store-a', userId: 'u-1' };

class FakeRepo implements PublicCatalogRepository {
  categories: PublicCategory[] = [];
  products: PublicProductRecord[] = [];
  lastQuery: PublicProductQuery | undefined;
  lastCatLimit = 0;
  lastCatCursor: Cursor | undefined;

  listPublishedCategories(
    _tx: TxHandle,
    limit: number,
    cursor?: Cursor,
  ): Promise<PublicCategory[]> {
    this.lastCatLimit = limit;
    this.lastCatCursor = cursor;
    const after = cursor
      ? this.categories.filter(
          (c) =>
            c.createdAt > cursor.createdAt ||
            (c.createdAt === cursor.createdAt && c.id > cursor.id),
        )
      : this.categories;
    return Promise.resolve(after.slice(0, limit));
  }
  listPublishedProducts(_tx: TxHandle, query: PublicProductQuery): Promise<PublicProductRecord[]> {
    this.lastQuery = query;
    return Promise.resolve(this.products.slice(0, query.limit));
  }
  findPublishedProduct(_tx: TxHandle, id: string): Promise<PublicProductRecord | null> {
    return Promise.resolve(this.products.find((p) => p.id === id) ?? null);
  }
}

const setup = () => {
  const repo = new FakeRepo();
  const contexts: TenantContext[] = [];
  const runner = {
    run: <T>(ctx: TenantContext, work: (tx: TxHandle) => Promise<T>): Promise<T> => {
      contexts.push(ctx);
      return work(TX);
    },
  };
  const service = new PublicCatalogService(runner, repo, encodeCursor);
  return { service, repo, contexts };
};

const cat = (n: number): PublicCategory => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `cat-${n}`,
  createdAt: `2026-11-27 00:00:${String(n).padStart(2, '0')}+00`,
});
const prod = (n: number, imageMediaId: string | null = null): PublicProductRecord => ({
  id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `prod-${n}`,
  description: null,
  priceAmount: '10.000',
  priceCurrency: 'EGP',
  categoryId: null,
  publishedAt: '2026-11-27 00:00:00+00',
  createdAt: `2026-11-27 00:00:${String(n).padStart(2, '0')}+00`,
  imageMediaId,
});

describe('PublicCatalogService', () => {
  it('unauthenticated reads run as GUEST, token reads as CUSTOMER (published-only either way)', async () => {
    const { service, contexts } = setup();
    await service.listCategories(GUEST, {});
    await service.listCategories(SIGNED, {});
    expect(contexts[0]).toEqual({ role: 'GUEST', tenantId: 't-1' });
    expect(contexts[1]).toEqual({ role: 'CUSTOMER', tenantId: 't-1', userId: 'u-1' });
  });

  it('category pages: limit+1 probing, nextCursor from the last row of the page', async () => {
    const { service, repo } = setup();
    repo.categories = [cat(1), cat(2), cat(3)];
    const page1 = await service.listCategories(GUEST, { limit: 2 });
    expect(repo.lastCatLimit).toBe(3); // limit + 1
    expect(page1.items.map((c) => c.name)).toEqual(['cat-1', 'cat-2']);
    expect(page1.nextCursor).not.toBeNull();
    const decoded = decodeCursor(page1.nextCursor as string);
    expect(decoded.id).toBe(cat(2).id);

    const page2 = await service.listCategories(GUEST, {
      limit: 2,
      cursor: page1.nextCursor as string,
    });
    expect(repo.lastCatCursor?.id).toBe(cat(2).id);
    expect(page2.nextCursor).toBeNull();
  });

  it('empty first page has no cursor', async () => {
    const { service } = setup();
    const page = await service.listCategories(GUEST, {});
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('product listing passes q/categoryId/cursor through, defaults limit to 20', async () => {
    const { service, repo } = setup();
    await service.listProducts(GUEST, { q: 'sneaker', categoryId: cat(9).id });
    expect(repo.lastQuery?.q).toBe('sneaker');
    expect(repo.lastQuery?.categoryId).toBe(cat(9).id);
    expect(repo.lastQuery?.limit).toBe(21);
  });

  it('rejects invalid limit, over-long q and malformed cursor before any query', async () => {
    const { service, repo } = setup();
    await expect(service.listProducts(GUEST, { limit: 51 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.listProducts(GUEST, { limit: 0 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.listProducts(GUEST, { q: 'x'.repeat(101) })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.listProducts(GUEST, { cursor: '%%not-a-cursor%%' })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
    expect(repo.lastQuery).toBeUndefined();
  });

  it('detail: found returns the record, missing is NOT_FOUND', async () => {
    const { service, repo } = setup();
    repo.products = [prod(1)];
    const found = await service.getProduct(GUEST, prod(1).id);
    expect(found.name).toBe('prod-1');
    await expect(service.getProduct(GUEST, prod(2).id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('imageUrl: built through the D3 route with the verified tenant code, null without an image', async () => {
    const { service, repo } = setup();
    const mediaId = '20000000-0000-4000-8000-00000000000a';
    repo.products = [prod(1, mediaId), prod(2)];
    const list = await service.listProducts(GUEST, {});
    expect(list.items[0]?.imageUrl).toBe(
      `/t/store-a/products/${prod(1).id}/media/${mediaId}/image`,
    );
    expect(list.items[1]?.imageUrl).toBeNull();
    const detail = await service.getProduct(GUEST, prod(1).id);
    expect(detail.imageUrl).toBe(`/t/store-a/products/${prod(1).id}/media/${mediaId}/image`);
    // the raw internal media id field never reaches the serialized projection
    const text = JSON.stringify({ list, detail });
    expect(text).not.toContain('imageMediaId');
  });

  it('imageUrl uses the tenant code of the request context, not another source', async () => {
    const { service, repo } = setup();
    const mediaId = '20000000-0000-4000-8000-00000000000b';
    repo.products = [prod(1, mediaId)];
    const other: PublicScope = { tenantId: 't-2', tenantCode: 'store-b' };
    const list = await service.listProducts(other, {});
    expect(list.items[0]?.imageUrl).toBe(
      `/t/store-b/products/${prod(1).id}/media/${mediaId}/image`,
    );
  });
});
