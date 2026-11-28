import { Prisma, PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import {
  PublicCatalogRepository,
  PublicCategory,
  PublicProductQuery,
  PublicProductRecord,
} from '../domain/public-catalog-repository';
import { Cursor, escapeLikePattern } from '../domain/public-catalog-rules';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

interface CategoryRow {
  id: string;
  name: string;
  created_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price_amount: string | null;
  price_currency: string | null;
  category_id: string | null;
  published_at: string;
  created_at: string;
  image_media_id: string | null;
}

const mapCategory = (r: CategoryRow): PublicCategory => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
});
const mapProduct = (r: ProductRow): PublicProductRecord => ({
  id: r.id,
  name: r.name,
  description: r.description,
  priceAmount: r.price_amount,
  priceCurrency: r.price_currency,
  categoryId: r.category_id,
  publishedAt: r.published_at,
  createdAt: r.created_at,
  imageMediaId: r.image_media_id,
});

/**
 * First eligible public image per product (Blocker B fix): the earliest ACTIVE
 * PRODUCT_IMAGE by (created_at, id) — deterministic, with the id as tie-breaker. Under
 * GUEST/CUSTOMER RLS the media_public_read policy already restricts the subquery to
 * exactly those rows of published products in the resolved tenant; the explicit kind,
 * status and tenant predicates repeat that boundary in the query itself, and selecting
 * only m.id::text keeps drive_file_key and object keys out of the projection.
 */
const IMAGE_SUBQUERY = `(SELECT m.id::text FROM media_assets m
         WHERE m.tenant_id = products.tenant_id AND m.product_id = products.id
           AND m.kind = 'PRODUCT_IMAGE' AND m.status = 'ACTIVE'
         ORDER BY m.created_at, m.id LIMIT 1) AS image_media_id`;

/**
 * Public catalog reads (IP-5 Step 4). The SELECT lists only the public projection plus
 * the selected image media id (internal; the service converts it to imageUrl and drops
 * it), so no internal or storage field can be serialized by accident. RLS (GUEST/CUSTOMER
 * public policies) is the tenant + publication boundary; the WHERE clauses here implement
 * only search text and the pagination window. All values are bound parameters; the LIKE
 * pattern additionally escapes wildcards with an explicit ESCAPE clause (STM-21).
 */
export class PrismaPublicCatalogRepository implements PublicCatalogRepository {
  async listPublishedCategories(
    tx: TxHandle,
    limit: number,
    cursor?: Cursor,
  ): Promise<PublicCategory[]> {
    const rows = cursor
      ? await txOf(tx).$queryRaw<CategoryRow[]>`
          SELECT id::text, name, created_at::text FROM categories
          WHERE (created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)
          ORDER BY created_at, id LIMIT ${limit}`
      : await txOf(tx).$queryRaw<CategoryRow[]>`
          SELECT id::text, name, created_at::text FROM categories
          ORDER BY created_at, id LIMIT ${limit}`;
    return rows.map(mapCategory);
  }

  async listPublishedProducts(
    tx: TxHandle,
    query: PublicProductQuery,
  ): Promise<PublicProductRecord[]> {
    const rows = await txOf(tx).$queryRaw<ProductRow[]>`
      SELECT id::text, name, description, price_amount::text, price_currency,
             category_id::text, published_at::text, created_at::text,
             ${Prisma.sql([IMAGE_SUBQUERY])}
      FROM products
      WHERE (${query.q ?? null}::text IS NULL
             OR name ILIKE ${'%' + escapeLikePattern(query.q ?? '') + '%'} ESCAPE '\\')
        AND (${query.categoryId ?? null}::uuid IS NULL OR category_id = ${query.categoryId ?? null}::uuid)
        AND (created_at, id) > (COALESCE(${query.cursor?.createdAt ?? null}::timestamptz, '-infinity'::timestamptz),
                                COALESCE(${query.cursor?.id ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
      ORDER BY created_at, id
      LIMIT ${query.limit}`;
    return rows.map(mapProduct);
  }

  async findPublishedProduct(tx: TxHandle, id: string): Promise<PublicProductRecord | null> {
    const rows = await txOf(tx).$queryRaw<ProductRow[]>`
      SELECT id::text, name, description, price_amount::text, price_currency,
             category_id::text, published_at::text, created_at::text,
             ${Prisma.sql([IMAGE_SUBQUERY])}
      FROM products WHERE id = ${id}::uuid`;
    return rows[0] ? mapProduct(rows[0]) : null;
  }
}
