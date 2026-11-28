import { TenantTransactionRunner } from '../../../common/tenancy/tenant-transaction-runner';
import { TenantContext } from '../../../common/tenancy/tenant-context';
import { CatalogError } from '../domain/catalog-errors';
import {
  PublicCatalogRepository,
  PublicCategory,
  PublicProduct,
  PublicProductRecord,
} from '../domain/public-catalog-repository';
import {
  Cursor,
  PUBLIC_DEFAULT_PAGE_SIZE,
  assertPageSize,
  assertSearchQuery,
  decodeCursor,
} from '../domain/public-catalog-rules';
import { assertUuidParam } from '../domain/catalog-rules';

/** Verified caller scope for public reads: tenant from URL resolution, identity from the token when one verified. */
export interface PublicScope {
  readonly tenantId: string;
  /**
   * The tenant code exactly as resolved and validated by TenantResolverGuard in this
   * request context (never from body, query or headers): public image URLs are built
   * with it, so a rendered link always points at the tenant the caller was verified
   * against (Blocker B fix, D3).
   */
  readonly tenantCode: string;
  /** Present only when a valid token was supplied; the read itself is published-only either way. */
  readonly userId?: string;
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export interface ProductListing {
  readonly q?: string;
  readonly categoryId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * Public catalog read use cases (IP-5 Step 4; spec 4.2, G4/G6, 8.6). Reads run under a
 * GUEST context (no token) or CUSTOMER context (any verified token, including a
 * merchant's): both RLS policy sets are published-only, so no token can widen public
 * visibility. The tenant comes from the resolved URL code, never from request input.
 */
export class PublicCatalogService {
  constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly repo: PublicCatalogRepository,
    private readonly encode: (c: Cursor) => string,
  ) {}

  private ctx(scope: PublicScope): TenantContext {
    return scope.userId === undefined
      ? { role: 'GUEST', tenantId: scope.tenantId }
      : { role: 'CUSTOMER', tenantId: scope.tenantId, userId: scope.userId };
  }

  async listCategories(
    scope: PublicScope,
    input: { limit?: number; cursor?: string },
  ): Promise<Page<PublicCategory>> {
    const limit = input.limit ?? PUBLIC_DEFAULT_PAGE_SIZE;
    assertPageSize(limit);
    const cursor = input.cursor !== undefined ? decodeCursor(input.cursor) : undefined;
    return this.runner.run(this.ctx(scope), async (tx) => {
      // limit + 1 rows: the extra row only tells us whether another page exists.
      const rows = await this.repo.listPublishedCategories(tx, limit + 1, cursor);
      return this.page(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.id }));
    });
  }

  async listProducts(scope: PublicScope, input: ProductListing): Promise<Page<PublicProduct>> {
    if (input.q !== undefined) assertSearchQuery(input.q);
    const limit = input.limit ?? PUBLIC_DEFAULT_PAGE_SIZE;
    assertPageSize(limit);
    const cursor = input.cursor !== undefined ? decodeCursor(input.cursor) : undefined;
    return this.runner.run(this.ctx(scope), async (tx) => {
      const rows = await this.repo.listPublishedProducts(tx, {
        q: input.q,
        categoryId: input.categoryId,
        limit: limit + 1,
        cursor,
      });
      const page = this.page(rows, limit, (r) => ({ createdAt: r.createdAt, id: r.id }));
      return { ...page, items: page.items.map((r) => this.toPublic(scope, r)) };
    });
  }

  async getProduct(scope: PublicScope, id: string): Promise<PublicProduct> {
    assertUuidParam(id);
    const record = await this.runner.run(this.ctx(scope), (tx) =>
      this.repo.findPublishedProduct(tx, id),
    );
    // Draft, other-tenant and unknown ids are the same 404: existence is never leaked (8.3).
    if (!record) throw new CatalogError('NOT_FOUND');
    return this.toPublic(scope, record);
  }

  /**
   * Maps the internal record to the serialized projection: imageMediaId becomes the D3
   * image URL under the request's verified tenant code (default variant applies, so no
   * size parameter), and the raw media id field itself is never serialized.
   */
  private toPublic(scope: PublicScope, r: PublicProductRecord): PublicProduct {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      priceAmount: r.priceAmount,
      priceCurrency: r.priceCurrency,
      categoryId: r.categoryId,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
      imageUrl:
        r.imageMediaId === null
          ? null
          : `/t/${scope.tenantCode}/products/${r.id}/media/${r.imageMediaId}/image`,
    };
  }

  private page<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): Page<T> {
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last !== undefined ? this.encode(cursorOf(last)) : null,
    };
  }
}
