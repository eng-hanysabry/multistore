import { PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { CatalogStatus } from '../domain/catalog-rules';
import {
  ProductInput,
  ProductPatch,
  ProductRecord,
  ProductRepository,
} from '../domain/product-repository';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

interface Row {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_amount: string | null;
  price_currency: string | null;
  status: CatalogStatus;
  published_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const SELECT =
  'SELECT id::text, tenant_id::text, category_id::text, name, description, price_amount::text, price_currency, status, published_at::text, created_by::text, created_at::text, updated_at::text FROM products';
const map = (r: Row): ProductRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  categoryId: r.category_id,
  name: r.name,
  description: r.description,
  priceAmount: r.price_amount,
  priceCurrency: r.price_currency,
  status: r.status,
  publishedAt: r.published_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Product persistence through the caller's transaction; RLS does the authorization (6.3). */
export class PrismaProductRepository implements ProductRepository {
  async list(tx: TxHandle): Promise<ProductRecord[]> {
    const rows = await txOf(tx).$queryRawUnsafe<Row[]>(`${SELECT} ORDER BY created_at, id`);
    return rows.map(map);
  }

  async findById(tx: TxHandle, id: string): Promise<ProductRecord | null> {
    const found = await txOf(tx).$queryRawUnsafe<Row[]>(`${SELECT} WHERE id = $1::uuid`, id);
    return found[0] ? map(found[0]) : null;
  }

  async categoryStatus(tx: TxHandle, categoryId: string): Promise<CatalogStatus | null> {
    const rows = await txOf(tx).$queryRaw<{ status: CatalogStatus }[]>`
      SELECT status FROM categories WHERE id = ${categoryId}::uuid`;
    return rows[0]?.status ?? null;
  }

  async countActiveImages(tx: TxHandle, productId: string): Promise<number> {
    const rows = await txOf(tx).$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM media_assets
      WHERE product_id = ${productId}::uuid AND kind = 'PRODUCT_IMAGE' AND status = 'ACTIVE'`;
    return rows[0]?.n ?? 0;
  }

  async countMedia(tx: TxHandle, productId: string): Promise<number> {
    const rows = await txOf(tx).$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM media_assets WHERE product_id = ${productId}::uuid`;
    return rows[0]?.n ?? 0;
  }

  async insert(tx: TxHandle, row: { id: string; createdBy: string } & ProductInput): Promise<void> {
    await txOf(tx).$executeRaw`
      INSERT INTO products (id, tenant_id, category_id, name, description, price_amount, price_currency, status, created_by)
      VALUES (${row.id}::uuid,
              NULLIF(current_setting('app.tenant_id', true), '')::uuid,
              ${row.categoryId ?? null}::uuid,
              ${row.name}, ${row.description ?? null},
              ${row.priceAmount ?? null}::numeric, ${row.priceCurrency ?? null}::char(3),
              'DRAFT', ${row.createdBy}::uuid)`;
  }

  async updateDraft(tx: TxHandle, id: string, fields: ProductPatch): Promise<boolean> {
    // Only provided fields change; status/published_at are lifecycle-controlled elsewhere.
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (clause: string, value: unknown, cast = ''): void => {
      params.push(value);
      sets.push(`${clause} = $${params.length}${cast}`);
    };
    if (fields.name !== undefined) push('name', fields.name);
    if (fields.description !== undefined) push('description', fields.description);
    if (fields.categoryId !== undefined) push('category_id', fields.categoryId, '::uuid');
    if (fields.priceAmount !== undefined) push('price_amount', fields.priceAmount, '::numeric');
    if (fields.priceCurrency !== undefined) push('price_currency', fields.priceCurrency);
    if (sets.length === 0) return true;
    params.push(id);
    const n = await txOf(tx).$executeRawUnsafe(
      `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}::uuid AND status = 'DRAFT'`,
      ...params,
    );
    return n > 0;
  }

  async setStatus(tx: TxHandle, id: string, status: CatalogStatus): Promise<boolean> {
    const n =
      status === 'PUBLISHED'
        ? await txOf(tx).$executeRaw`
            UPDATE products SET status = 'PUBLISHED', published_at = now(), updated_at = now()
            WHERE id = ${id}::uuid`
        : await txOf(tx).$executeRaw`
            UPDATE products SET status = 'DRAFT', published_at = NULL, updated_at = now()
            WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async deleteById(tx: TxHandle, id: string): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`DELETE FROM products WHERE id = ${id}::uuid`;
    return n > 0;
  }
}
