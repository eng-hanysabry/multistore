import { PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { CatalogStatus } from '../domain/catalog-rules';
import { CategoryRecord, CategoryRepository } from '../domain/category-repository';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  status: CatalogStatus;
  published_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const SELECT =
  'SELECT id::text, tenant_id::text, name, status, published_at::text, created_by::text, created_at::text, updated_at::text FROM categories';
const map = (r: Row): CategoryRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  status: r.status,
  publishedAt: r.published_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Category persistence through the caller's transaction; RLS does the authorization (6.3). */
export class PrismaCategoryRepository implements CategoryRepository {
  async list(tx: TxHandle): Promise<CategoryRecord[]> {
    const rows = await txOf(tx).$queryRawUnsafe<Row[]>(`${SELECT} ORDER BY created_at, id`);
    return rows.map(map);
  }

  async findById(tx: TxHandle, id: string): Promise<CategoryRecord | null> {
    const found = await txOf(tx).$queryRawUnsafe<Row[]>(`${SELECT} WHERE id = $1::uuid`, id);
    return found[0] ? map(found[0]) : null;
  }

  async insert(tx: TxHandle, row: { id: string; name: string; createdBy: string }): Promise<void> {
    await txOf(tx).$executeRaw`
      INSERT INTO categories (id, tenant_id, name, status, created_by)
      VALUES (${row.id}::uuid,
              NULLIF(current_setting('app.tenant_id', true), '')::uuid,
              ${row.name}, 'DRAFT', ${row.createdBy}::uuid)`;
  }

  async updateName(tx: TxHandle, id: string, name: string): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`
      UPDATE categories SET name = ${name}, updated_at = now() WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async setStatus(tx: TxHandle, id: string, status: CatalogStatus): Promise<boolean> {
    const n =
      status === 'PUBLISHED'
        ? await txOf(tx).$executeRaw`
            UPDATE categories SET status = 'PUBLISHED', published_at = now(), updated_at = now()
            WHERE id = ${id}::uuid`
        : await txOf(tx).$executeRaw`
            UPDATE categories SET status = 'DRAFT', published_at = NULL, updated_at = now()
            WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async countProducts(tx: TxHandle, id: string): Promise<number> {
    const rows = await txOf(tx).$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM products WHERE category_id = ${id}::uuid`;
    return rows[0]?.n ?? 0;
  }

  async countPublishedProducts(tx: TxHandle, id: string): Promise<number> {
    const rows = await txOf(tx).$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM products WHERE category_id = ${id}::uuid AND status = 'PUBLISHED'`;
    return rows[0]?.n ?? 0;
  }

  async deleteById(tx: TxHandle, id: string): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`DELETE FROM categories WHERE id = ${id}::uuid`;
    return n > 0;
  }
}
