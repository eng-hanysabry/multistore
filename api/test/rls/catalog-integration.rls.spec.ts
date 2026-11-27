import { PrismaClient } from '@prisma/client';
import { PrismaTenantTransactionRunner } from '../../src/infrastructure/prisma/tenant-transaction-runner';
import {
  CatalogService,
  MerchantScope,
} from '../../src/modules/catalog/application/catalog-service';
import { PrismaCategoryRepository } from '../../src/modules/catalog/infrastructure/prisma-category-repository';
import { PrismaProductRepository } from '../../src/modules/catalog/infrastructure/prisma-product-repository';
import { PrismaIdempotencyRepository } from '../../src/modules/catalog/infrastructure/prisma-idempotency-repository';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * The Step 3 service and its real Prisma repositories against real PostgreSQL with RLS
 * on, connected as multistore_app (never a superuser): tenant isolation through the
 * repository layer, the publish gates against real rows, and the idempotency contract
 * (10.7) including a concurrent duplicate. Seeds run as the superuser because FORCE RLS
 * binds the owner.
 */

const TENANT_A = seedId(4010);
const TENANT_B = seedId(4011);
const USER_M_A = seedId(4012);
const USER_M_B = seedId(4013);
const CAT_B = seedId(4020);

const A: MerchantScope = { tenantId: TENANT_A, userId: USER_M_A };
const B: MerchantScope = { tenantId: TENANT_B, userId: USER_M_B };

let db: PrismaClient;
let service: CatalogService;

const su = async <T>(fn: (c: ReturnType<typeof superClient>) => Promise<T>): Promise<T> => {
  const c = superClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  await applyMigration('20261127221500_ip5_catalog_and_media');
  process.env['DATABASE_URL'] = appDatabaseUrl();
  db = new PrismaClient();
  service = new CatalogService(
    new PrismaTenantTransactionRunner(db),
    new PrismaCategoryRepository(),
    new PrismaProductRepository(),
    new PrismaIdempotencyRepository(),
  );
  await su(async (c) => {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'ci-alpha','A','ACTIVE'),($2,'ci-beta','B','ACTIVE')",
      [TENANT_A, TENANT_B],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'cia@example.com','h','ACTIVE'),($2,'cib@example.com','h','ACTIVE')",
      [USER_M_A, USER_M_B],
    );
    await c.query(
      "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ($1,$2,'B-cat','DRAFT',$3)",
      [CAT_B, TENANT_B, USER_M_B],
    );
  });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
});

beforeEach(async () => {
  await su(async (c) => {
    await c.query('DELETE FROM media_assets WHERE tenant_id = $1', [TENANT_A]);
    await c.query('DELETE FROM products WHERE tenant_id = $1', [TENANT_A]);
    await c.query('DELETE FROM categories WHERE tenant_id = $1', [TENANT_A]);
    await c.query('DELETE FROM idempotency_keys WHERE tenant_id = $1', [TENANT_A]);
  });
});

describe('catalog service over real RLS (6.3, 6.4)', () => {
  it('tenant isolation: A sees its own rows only, B never sees them', async () => {
    const created = await service.createCategory(A, { name: 'A-cat' });
    expect(created.status).toBe(201);
    expect(created.body.tenantId).toBe(TENANT_A);
    expect(created.body.createdBy).toBe(USER_M_A);
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const listA = await service.listCategories(A);
    expect(listA.map((c) => c.name)).toEqual(['A-cat']);
    const listB = await service.listCategories(B);
    expect(listB.map((c) => c.name)).toEqual(['B-cat']);
    await expect(service.getCategory(B, created.body.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('publish gates against real rows: draft category, missing image, then success', async () => {
    const cat = (await service.createCategory(A, { name: 'Shoes' })).body;
    const draftCatProduct = (await service.createProduct(A, { name: 'P1', categoryId: cat.id }))
      .body;
    await expect(service.publishProduct(A, draftCatProduct.id)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_PUBLISHED',
    });

    await service.publishCategory(A, cat.id);
    await expect(service.publishProduct(A, draftCatProduct.id)).rejects.toMatchObject({
      code: 'IMAGE_REQUIRED',
    });

    await su((c) =>
      c.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [seedId(4030), TENANT_A, draftCatProduct.id, USER_M_A],
      ),
    );
    const published = await service.publishProduct(A, draftCatProduct.id);
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.publishedAt).not.toBeNull();

    // M-4: the category now has a published product, so unpublish is blocked
    await expect(service.unpublishCategory(A, cat.id)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_PUBLISHED_PRODUCTS',
    });
    await service.unpublishProduct(A, draftCatProduct.id);
    await service.unpublishCategory(A, cat.id);
  });

  it('idempotency: sequential replay, hash conflict, and concurrent duplicate (10.7)', async () => {
    const first = await service.createCategory(A, { name: 'Idem' }, 'key-1');
    const replay = await service.createCategory(A, { name: 'Idem' }, 'key-1');
    expect(replay.replayed).toBe(true);
    expect(replay.body.id).toBe(first.body.id);

    await expect(service.createCategory(A, { name: 'Other' }, 'key-1')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });

    // concurrent duplicate: both callers get the same winning record, one row exists
    const [r1, r2] = await Promise.all([
      service.createCategory(A, { name: 'Race' }, 'key-race'),
      service.createCategory(A, { name: 'Race' }, 'key-race'),
    ]);
    expect(r1.body.id).toBe(r2.body.id);
    const rows = await su(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM categories WHERE tenant_id = $1 AND name = 'Race'",
            [TENANT_A],
          )
        ).rows[0] as { n: number },
    );
    expect(rows.n).toBe(1);

    // the stored record is scoped to (tenant, user): the same key under tenant B is a different scope
    const other = await service.createCategory(B, { name: 'B-idem' }, 'key-1');
    expect(other.status).toBe(201);
    await su((c) =>
      c.query('DELETE FROM categories WHERE tenant_id = $1 AND name = $2', [TENANT_B, 'B-idem']),
    );
  });

  it('draft-only delete and update over the real repository', async () => {
    const product = (
      await service.createProduct(A, {
        name: 'Temp',
        description: 'd',
        priceAmount: 10.25,
        priceCurrency: 'EGP',
      })
    ).body;
    expect(product.priceAmount).toBe('10.250'); // numeric(14,3) scale is preserved exactly

    const updated = await service.updateProduct(A, product.id, { name: 'Temp2' });
    expect(updated.name).toBe('Temp2');
    expect(updated.priceCurrency).toBe('EGP');

    await su((c) =>
      c.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [seedId(4031), TENANT_A, product.id, USER_M_A],
      ),
    );
    await service.publishProduct(A, product.id);
    await expect(service.deleteProduct(A, product.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await service.unpublishProduct(A, product.id);
    // draft again, but the media row still references it (FK ON DELETE RESTRICT)
    await expect(service.deleteProduct(A, product.id)).rejects.toMatchObject({
      code: 'PRODUCT_HAS_MEDIA',
    });
    await su((c) => c.query('DELETE FROM media_assets WHERE product_id = $1', [product.id]));
    await service.deleteProduct(A, product.id);
    await expect(service.getProduct(A, product.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
