import { PrismaClient } from '@prisma/client';
import { PrismaTenantTransactionRunner } from '../../src/infrastructure/prisma/tenant-transaction-runner';
import {
  PublicCatalogService,
  PublicScope,
} from '../../src/modules/catalog/application/public-catalog-service';
import { PrismaPublicCatalogRepository } from '../../src/modules/catalog/infrastructure/prisma-public-catalog-repository';
import { encodeCursor } from '../../src/modules/catalog/domain/public-catalog-rules';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * Public catalog reads against real PostgreSQL with RLS on, connected as multistore_app:
 * GUEST and CUSTOMER visibility (published only), tenant isolation, search with wildcard
 * escaping, cursor pagination across duplicate timestamps, SQL-injection safety (STM-21)
 * and response-shape leakage scanning. Seeds run as the superuser (FORCE RLS binds the
 * owner); published rows go through the real lifecycle where guards require it.
 */

const TENANT_A = seedId(6010);
const TENANT_B = seedId(6011);
const USER_M_A = seedId(6012);
const USER_C = seedId(6013);

const CAT_A_PUB = seedId(6020);
const CAT_A_DRAFT = seedId(6021);
const CAT_B_PUB = seedId(6022);

const PROD_A1 = seedId(6030); // 'Sneaker Red'   created 01-01
const PROD_A2 = seedId(6031); // 'Sneaker Blue'  created 01-02 (tie)
const PROD_A3 = seedId(6032); // '100% Cotton Shirt' created 01-02 (tie)
const PROD_A4 = seedId(6033); // 'Boots'          created 01-03 (tie)
const PROD_A5 = seedId(6034); // 'Cap_Special'    created 01-03 (tie)
const PROD_A_DRAFT = seedId(6035);
const PROD_B = seedId(6036);

const GUEST: PublicScope = { tenantId: TENANT_A };
const CUSTOMER: PublicScope = { tenantId: TENANT_A, userId: USER_C };

let db: PrismaClient;
let service: PublicCatalogService;

const su = async <T>(fn: (c: ReturnType<typeof superClient>) => Promise<T>): Promise<T> => {
  const c = superClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

const productCount = () =>
  su(
    async (c) =>
      (await c.query('SELECT count(*)::int AS n FROM products')).rows[0] as { n: number },
  );

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  await applyMigration('20261127221500_ip5_catalog_and_media');
  process.env['DATABASE_URL'] = appDatabaseUrl();
  db = new PrismaClient();
  service = new PublicCatalogService(
    new PrismaTenantTransactionRunner(db),
    new PrismaPublicCatalogRepository(),
    encodeCursor,
  );
  await su(async (c) => {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'pub-alpha','A','ACTIVE'),($2,'pub-beta','B','ACTIVE'),($3,'pub-susp','S','SUSPENDED')",
      [TENANT_A, TENANT_B, seedId(6014)],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'pma@example.com','h','ACTIVE'),($2,'pc@example.com','h','ACTIVE')",
      [USER_M_A, USER_C],
    );
    await c.query(
      "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ($1,$2,'A-pub','DRAFT',$4),($3,$2,'A-draft','DRAFT',$4),($5,$6,'B-pub','DRAFT',$7)",
      [CAT_A_PUB, TENANT_A, CAT_A_DRAFT, USER_M_A, CAT_B_PUB, TENANT_B, USER_M_A],
    );
    await c.query(
      "UPDATE categories SET status='PUBLISHED', published_at=now() WHERE id = ANY($1)",
      [[CAT_A_PUB, CAT_B_PUB]],
    );
    // Draft rows first; publication through the lifecycle requires an ACTIVE image.
    await c.query(
      `INSERT INTO products (id, tenant_id, category_id, name, description, price_amount, price_currency, status, created_by, created_at) VALUES
       ($1,$2,$9,'Sneaker Red','red',10.5,'EGP','DRAFT',$10,'2026-01-01 00:00:00+00'),
       ($3,$2,$9,'Sneaker Blue',NULL,NULL,NULL,'DRAFT',$10,'2026-01-02 00:00:00+00'),
       ($4,$2,NULL,'100% Cotton Shirt','cotton',99.999,'USD','DRAFT',$10,'2026-01-02 00:00:00+00'),
       ($5,$2,$9,'Boots','leather',250,'EGP','DRAFT',$10,'2026-01-03 00:00:00+00'),
       ($6,$2,NULL,'Cap_Special',NULL,15.1,'EGP','DRAFT',$10,'2026-01-03 00:00:00+00'),
       ($7,$2,$9,'Draft Boots',NULL,1,'EGP','DRAFT',$10,'2026-01-04 00:00:00+00'),
       ($8,$11,$12,'B-Prod',NULL,5,'EGP','DRAFT',$10,'2026-01-01 00:00:00+00')`,
      [
        PROD_A1,
        TENANT_A,
        PROD_A2,
        PROD_A3,
        PROD_A4,
        PROD_A5,
        PROD_A_DRAFT,
        PROD_B,
        CAT_A_PUB,
        USER_M_A,
        TENANT_B,
        CAT_B_PUB,
      ],
    );
    const pubIds = [PROD_A1, PROD_A2, PROD_A3, PROD_A4, PROD_A5, PROD_B];
    for (const [i, pid] of pubIds.entries()) {
      const tenant = pid === PROD_B ? TENANT_B : TENANT_A;
      await c.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [seedId(6050 + i), tenant, pid, USER_M_A],
      );
      await c.query("UPDATE products SET status='PUBLISHED', published_at=now() WHERE id=$1", [
        pid,
      ]);
    }
  });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
});

describe('public catalog reads over real RLS (STM-04, STM-07, STM-21)', () => {
  it('guest sees only published categories and products of the URL tenant', async () => {
    const cats = await service.listCategories(GUEST, {});
    expect(cats.items.map((c) => c.name)).toEqual(['A-pub']);
    const products = await service.listProducts(GUEST, {});
    expect(products.items.map((p) => p.name)).toEqual([
      'Sneaker Red',
      'Sneaker Blue',
      '100% Cotton Shirt',
      'Boots',
      'Cap_Special',
    ]);
    // the CUSTOMER context sees exactly the same published surface
    const asCustomer = await service.listProducts(CUSTOMER, {});
    expect(asCustomer.items.map((p) => p.name)).toEqual(products.items.map((p) => p.name));
  });

  it('detail: draft, cross-tenant and unknown ids are the same NOT_FOUND', async () => {
    const ok = await service.getProduct(GUEST, PROD_A1);
    expect(ok.name).toBe('Sneaker Red');
    expect(ok.priceAmount).toBe('10.500'); // numeric(14,3) exact text
    await expect(service.getProduct(GUEST, PROD_A_DRAFT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.getProduct(GUEST, PROD_B)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getProduct(GUEST, seedId(6999))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('search is tenant-scoped, case-insensitive, and treats wildcards literally', async () => {
    const sneaker = await service.listProducts(GUEST, { q: 'sneaker' });
    expect(sneaker.items.map((p) => p.name).sort()).toEqual(['Sneaker Blue', 'Sneaker Red']);
    const pct = await service.listProducts(GUEST, { q: '100%' });
    expect(pct.items.map((p) => p.name)).toEqual(['100% Cotton Shirt']);
    const onlyPercent = await service.listProducts(GUEST, { q: '%' });
    expect(onlyPercent.items.map((p) => p.name)).toEqual(['100% Cotton Shirt']);
    const underscore = await service.listProducts(GUEST, { q: '_' });
    expect(underscore.items.map((p) => p.name)).toEqual(['Cap_Special']);
    const backslash = await service.listProducts(GUEST, { q: '\\' });
    expect(backslash.items).toEqual([]);
    // search never crosses tenants
    const asB: PublicScope = { tenantId: TENANT_B };
    const bSearch = await service.listProducts(asB, { q: 'sneaker' });
    expect(bSearch.items).toEqual([]);
  });

  it('cursor pagination is stable across duplicate created_at values', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const result = await service.listProducts(GUEST, { limit: 2, cursor });
      seen.push(...result.items.map((p) => p.id));
      cursor = result.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined(); // 5 items, 2 per page, 3rd page has 1 and no cursor
    expect(seen).toEqual([PROD_A1, PROD_A2, PROD_A3, PROD_A4, PROD_A5]);
    expect(new Set(seen).size).toBe(5); // no duplicates from the timestamp ties
  });

  it('categoryId filter only returns published products of a published category', async () => {
    const inCat = await service.listProducts(GUEST, { categoryId: CAT_A_PUB });
    expect(inCat.items.map((p) => p.name)).toEqual(['Sneaker Red', 'Sneaker Blue', 'Boots']);
    const draftCat = await service.listProducts(GUEST, { categoryId: CAT_A_DRAFT });
    expect(draftCat.items).toEqual([]);
  });

  it('STM-21: injection payloads are safe and leave the database unchanged', async () => {
    const before = (await productCount()).n;
    const payloads = [
      "'; DROP TABLE products;--",
      "' OR '1'='1",
      '%%\\',
      "'; SELECT pg_sleep(5);--",
    ];
    for (const q of payloads) {
      const result = await service.listProducts(GUEST, { q });
      expect(result.items).toEqual([]);
    }
    const evilCursor = Buffer.from(
      JSON.stringify({ c: "2026-01-01' OR '1'='1", i: PROD_A1 }),
    ).toString('base64url');
    await expect(service.listProducts(GUEST, { cursor: evilCursor })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.listProducts(GUEST, { limit: 51 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(service.listProducts(GUEST, { q: 'x'.repeat(101) })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect((await productCount()).n).toBe(before);
  });

  it('response projection carries no internal or storage fields (leakage scan)', async () => {
    const list = await service.listProducts(GUEST, {});
    const detail = await service.getProduct(GUEST, PROD_A1);
    const cats = await service.listCategories(GUEST, {});
    for (const payload of [list, detail, cats]) {
      const text = JSON.stringify(payload);
      for (const forbidden of [
        'drive_file_key',
        'drive',
        'tenant_id',
        'tenantId',
        'created_by',
        'createdBy',
        'updated_at',
        'updatedAt',
        'UPLOADING',
        'ORPHANED',
        'media_assets',
        'google',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
