import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/modules/auth/domain/auth-rules';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * Public catalog endpoints over real HTTP with RLS on (IP-5 Step 4 acceptance):
 * optional authentication (a bad token is 401, never a silent Guest), published-only
 * visibility for Guest/Customer/Merchant tokens alike, tenant resolution (unknown and
 * suspended are 404), DTO whitelist and caps, cursor pagination, STM-21 injection
 * safety, and a response-shape scan of every public endpoint.
 */

const JWT_SECRET = 'public-catalog-http-spec-secret-0123456789ab';

const TENANT_A = seedId(7010);
const TENANT_B = seedId(7011);
const TENANT_SUSP = seedId(7012);
const USER_M_A = seedId(7013);
const USER_C = seedId(7014);

const CAT_A_PUB = seedId(7020);
const CAT_A_DRAFT = seedId(7021);
const PROD_A_PUB = seedId(7030);
const PROD_A_PUB2 = seedId(7031);
const PROD_A_DRAFT = seedId(7032);
const PROD_B_PUB = seedId(7033);

let app: INestApplication;
let customer: string;
let merchantA: string;

const su = async <T>(fn: (c: ReturnType<typeof superClient>) => Promise<T>): Promise<T> => {
  const c = superClient();
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
};

const http = () => request(app.getHttpServer() as never);

const expectSafeShape = (body: unknown): void => {
  const text = JSON.stringify(body);
  for (const forbidden of [
    'drive_file_key',
    'drive',
    'tenant_id',
    'tenantId',
    'created_by',
    'createdBy',
    'updated_at',
    'updatedAt',
    'media_assets',
    'googleapis',
    'stack',
  ]) {
    expect(text).not.toContain(forbidden);
  }
};

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261125000001_ip3_mail_and_health');
  await applyMigration('20261126160002_ip4_identity_tenancy');
  await applyMigration('20261127221500_ip5_catalog_and_media');
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = appDatabaseUrl();
  process.env['JWT_SECRET'] = JWT_SECRET;
  process.env['OUTBOX_MODE'] = 'sweep';
  process.env['CRON_SECRET'] = 'http-spec-cron-secret-0123456789abcdef';
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();

  const signer = new JwtAccessTokenSigner(JWT_SECRET);
  customer = await signer.sign(USER_C, 'CUSTOMER', seedId(7015));
  merchantA = await signer.sign(USER_M_A, 'MERCHANT', seedId(7016));

  await su(async (c) => {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'pub2-alpha','A','ACTIVE'),($2,'pub2-beta','B','ACTIVE'),($3,'pub2-susp','S','SUSPENDED')",
      [TENANT_A, TENANT_B, TENANT_SUSP],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'hma2@example.com','h','ACTIVE'),($2,'hc2@example.com','h','ACTIVE')",
      [USER_M_A, USER_C],
    );
    await c.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE')",
      [seedId(7017), TENANT_A, USER_M_A],
    );
    await c.query(
      "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ($1,$2,'A-pub','DRAFT',$3),($4,$2,'A-draft','DRAFT',$3)",
      [CAT_A_PUB, TENANT_A, USER_M_A, CAT_A_DRAFT],
    );
    await c.query("UPDATE categories SET status='PUBLISHED', published_at=now() WHERE id=$1", [
      CAT_A_PUB,
    ]);
    await c.query(
      `INSERT INTO products (id, tenant_id, category_id, name, status, created_by) VALUES
       ($1,$2,$5,'Alpha One','DRAFT',$6),($3,$2,NULL,'Alpha Two','DRAFT',$6),($4,$2,$5,'Alpha Draft','DRAFT',$6)`,
      [PROD_A_PUB, TENANT_A, PROD_A_PUB2, PROD_A_DRAFT, CAT_A_PUB, USER_M_A],
    );
    for (const [i, pid] of [PROD_A_PUB, PROD_A_PUB2].entries()) {
      await c.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [seedId(7050 + i), TENANT_A, pid, USER_M_A],
      );
      await c.query("UPDATE products SET status='PUBLISHED', published_at=now() WHERE id=$1", [
        pid,
      ]);
    }
    await c.query(
      "INSERT INTO products (id, tenant_id, name, status, created_by) VALUES ($1,$2,'B-Prod','DRAFT',$3)",
      [PROD_B_PUB, TENANT_B, USER_M_A],
    );
    await c.query(
      "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
      [seedId(7052), TENANT_B, PROD_B_PUB, USER_M_A],
    );
    await c.query("UPDATE products SET status='PUBLISHED', published_at=now() WHERE id=$1", [
      PROD_B_PUB,
    ]);
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('public catalog endpoints over HTTP (Step 4, STM-04/07/21)', () => {
  it('guest browsing: categories, products, search, detail; published only', async () => {
    const cats = await http().get('/t/pub2-alpha/categories').expect(200);
    expect(cats.body.items.map((c: { name: string }) => c.name)).toEqual(['A-pub']);
    expectSafeShape(cats.body);

    const products = await http().get('/t/pub2-alpha/products').expect(200);
    expect(products.body.items.map((p: { name: string }) => p.name).sort()).toEqual([
      'Alpha One',
      'Alpha Two',
    ]);
    expect(products.body.nextCursor).toBeNull();
    // Blocker B fix: every published product exposes its public image through the D3 route
    const byId = new Map<string, string | null>(
      products.body.items.map((p: { id: string; imageUrl: string | null }) => [p.id, p.imageUrl]),
    );
    expect(byId.get(PROD_A_PUB)).toBe(
      `/t/pub2-alpha/products/${PROD_A_PUB}/media/${seedId(7050)}/image`,
    );
    expect(byId.get(PROD_A_PUB2)).toBe(
      `/t/pub2-alpha/products/${PROD_A_PUB2}/media/${seedId(7051)}/image`,
    );
    expectSafeShape(products.body);

    const search = await http().get('/t/pub2-alpha/products?q=alpha two').expect(200);
    expect(search.body.items.map((p: { name: string }) => p.name)).toEqual(['Alpha Two']);

    const detail = await http().get(`/t/pub2-alpha/products/${PROD_A_PUB}`).expect(200);
    expect(detail.body.name).toBe('Alpha One');
    expect(detail.body.status).toBeUndefined();
    expect(detail.body.imageUrl).toBe(
      `/t/pub2-alpha/products/${PROD_A_PUB}/media/${seedId(7050)}/image`,
    );
    expect(detail.body.imageMediaId).toBeUndefined();
    expectSafeShape(detail.body);
  });

  it('optional auth: invalid or expired tokens are 401, never a silent guest', async () => {
    await http()
      .get('/t/pub2-alpha/products')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
    const { JwtService } = await import('@nestjs/jwt');
    const expired = await new JwtService({
      secret: JWT_SECRET,
      signOptions: {
        expiresIn: -60,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
      },
    }).signAsync({ sub: USER_C, role: 'CUSTOMER', sid: seedId(7018) });
    await http()
      .get('/t/pub2-alpha/products')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('customer and merchant tokens get the same published-only surface', async () => {
    const asCustomer = await http()
      .get('/t/pub2-alpha/products')
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    expect(asCustomer.body.items).toHaveLength(2);
    // a merchant of this tenant still sees ONLY published rows on the public surface
    const asMerchant = await http()
      .get('/t/pub2-alpha/products')
      .set('Authorization', `Bearer ${merchantA}`)
      .expect(200);
    expect(asMerchant.body.items.map((p: { name: string }) => p.name).sort()).toEqual([
      'Alpha One',
      'Alpha Two',
    ]);
  });

  it('draft, cross-tenant, unknown and suspended all return the safe 404', async () => {
    await http().get(`/t/pub2-alpha/products/${PROD_A_DRAFT}`).expect(404);
    await http().get(`/t/pub2-alpha/products/${PROD_B_PUB}`).expect(404);
    await http()
      .get(`/t/pub2-alpha/products/${seedId(7999)}`)
      .expect(404);
    await http().get('/t/pub2-susp/products').expect(404);
    await http().get('/t/no-such-store/products').expect(404);
    const res = await http().get(`/t/pub2-alpha/products/${PROD_A_DRAFT}`);
    expect(res.body.code).toBe('NOT_FOUND');
    expectSafeShape(res.body);
  });

  it('validation caps: limit, q length, cursor, unknown params, bad categoryId', async () => {
    await http().get('/t/pub2-alpha/products?limit=51').expect(400);
    await http().get('/t/pub2-alpha/products?limit=0').expect(400);
    await http().get('/t/pub2-alpha/products?limit=abc').expect(400);
    await http()
      .get(`/t/pub2-alpha/products?q=${'x'.repeat(101)}`)
      .expect(400);
    await http().get('/t/pub2-alpha/products?cursor=%%bad%%').expect(400);
    await http().get(`/t/pub2-alpha/products?categoryId=not-a-uuid`).expect(400);
    // a tenant_id query parameter is an unknown field and is rejected, never used (6.3)
    await http().get(`/t/pub2-alpha/products?tenant_id=${TENANT_B}`).expect(400);
  });

  it('cursor pagination over HTTP with duplicate timestamps stays stable', async () => {
    await su(async (c) => {
      await c.query(
        "UPDATE products SET created_at = '2026-02-01 00:00:00+00' WHERE id = ANY($1)",
        [[PROD_A_PUB, PROD_A_PUB2]],
      );
    });
    const page1 = await http().get('/t/pub2-alpha/products?limit=1').expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await http()
      .get(`/t/pub2-alpha/products?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('STM-21: injection payloads in every public input are safe', async () => {
    const injections = [
      `/t/pub2-alpha/products?q=${encodeURIComponent("'; DROP TABLE products;--")}`,
      `/t/pub2-alpha/products?q=${encodeURIComponent("' OR '1'='1")}`,
      `/t/pub2-alpha/products/${encodeURIComponent("1' OR '1'='1")}`,
    ];
    for (const url of injections) {
      const res = await http().get(url);
      expect([200, 400, 404]).toContain(res.status);
      expectSafeShape(res.body);
      if (res.status === 200) expect(res.body.items ?? []).toEqual([]);
    }
    const count = await su(
      async (c) =>
        (await c.query('SELECT count(*)::int AS n FROM products')).rows[0] as { n: number },
    );
    expect(count.n).toBeGreaterThan(0);
  });
});
