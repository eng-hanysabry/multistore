import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * The merchant catalog endpoints over real HTTP against real PostgreSQL with RLS on:
 * the full global guard chain (JWT, MERCHANT role, URL tenant resolution, membership
 * re-check), DTO whitelisting (tenant_id can never arrive in a body), tenant isolation,
 * lifecycle behavior, idempotency over HTTP and safe error bodies (5.4, 6.3, 6.8, 8.6).
 */

const JWT_SECRET = 'catalog-http-spec-secret-0123456789abcdef01';

const TENANT_A = seedId(5010);
const TENANT_B = seedId(5011);
const USER_M_A = seedId(5012);
const USER_M_B = seedId(5013);
const USER_C = seedId(5014);

let app: INestApplication;
let merchantA: string;
let merchantB: string;
let customer: string;

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
const asA = () => ({ Authorization: `Bearer ${merchantA}` });

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
  merchantA = await signer.sign(USER_M_A, 'MERCHANT', seedId(5021));
  merchantB = await signer.sign(USER_M_B, 'MERCHANT', seedId(5022));
  customer = await signer.sign(USER_C, 'CUSTOMER', seedId(5023));

  await su(async (c) => {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'http-alpha','A','ACTIVE'),($2,'http-beta','B','ACTIVE')",
      [TENANT_A, TENANT_B],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'hma@example.com','h','ACTIVE'),($2,'hmb@example.com','h','ACTIVE'),($3,'hc@example.com','h','ACTIVE')",
      [USER_M_A, USER_M_B, USER_C],
    );
    await c.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE'),($4,$5,$6,'MERCHANT','ACTIVE')",
      [seedId(5015), TENANT_A, USER_M_A, seedId(5016), TENANT_B, USER_M_B],
    );
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('merchant catalog endpoints over HTTP (8.6)', () => {
  it('guard chain: unauthenticated, wrong role, wrong tenant membership', async () => {
    await http().get('/t/http-alpha/merchant/categories').expect(401);
    await http()
      .get('/t/http-alpha/merchant/categories')
      .set('Authorization', `Bearer ${customer}`)
      .expect(403);
    // merchant B is a real merchant, but not of tenant A: 404, the tenant's
    // existence is never confirmed to non-members (6.3 step 4, 8.3)
    await http()
      .get('/t/http-alpha/merchant/categories')
      .set('Authorization', `Bearer ${merchantB}`)
      .expect(404);
    await http().get('/t/http-alpha/merchant/categories').set(asA()).expect(200);
  });

  it('CRUD and lifecycle with safe errors, DTO whitelist, and tenant isolation', async () => {
    // tenant_id in a body is rejected by the whitelist pipe, never trusted (6.3)
    const hijack = await http()
      .post('/t/http-alpha/merchant/categories')
      .set(asA())
      .send({ name: 'X', tenant_id: TENANT_B })
      .expect(400);
    expect(hijack.body.stack).toBeUndefined();

    const created = await http()
      .post('/t/http-alpha/merchant/categories')
      .set(asA())
      .send({ name: 'Shoes' })
      .expect(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.created_by ?? created.body.createdBy).toBeTruthy();
    const catId = created.body.id as string;

    // idempotency over HTTP: replay returns the first result
    const first = await http()
      .post('/t/http-alpha/merchant/categories')
      .set(asA())
      .set('Idempotency-Key', 'http-k1')
      .send({ name: 'Bags' })
      .expect(201);
    const replay = await http()
      .post('/t/http-alpha/merchant/categories')
      .set(asA())
      .set('Idempotency-Key', 'http-k1')
      .send({ name: 'Bags' })
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    const conflict = await http()
      .post('/t/http-alpha/merchant/categories')
      .set(asA())
      .set('Idempotency-Key', 'http-k1')
      .send({ name: 'Different' })
      .expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    // product lifecycle through HTTP
    await http().post(`/t/http-alpha/merchant/categories/${catId}/publish`).set(asA()).expect(200);
    const product = await http()
      .post('/t/http-alpha/merchant/products')
      .set(asA())
      .send({ name: 'Sneaker', categoryId: catId, priceAmount: 199.5, priceCurrency: 'EGP' })
      .expect(201);
    const prodId = product.body.id as string;
    expect(product.body.status).toBe('DRAFT');

    const noImage = await http()
      .post(`/t/http-alpha/merchant/products/${prodId}/publish`)
      .set(asA())
      .expect(409);
    expect(noImage.body.code).toBe('IMAGE_REQUIRED');
    // safe error shape: code + message, no internals (6.8)
    expect(typeof noImage.body.message).toBe('string');
    expect(noImage.body.stack).toBeUndefined();
    expect(noImage.body.path).toBeUndefined();

    await su((c) =>
      c.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [seedId(5030), TENANT_A, prodId, USER_M_A],
      ),
    );
    const published = await http()
      .post(`/t/http-alpha/merchant/products/${prodId}/publish`)
      .set(asA())
      .set('Idempotency-Key', 'http-pub-1')
      .expect(200);
    expect(published.body.status).toBe('PUBLISHED');

    // tenant B's merchant cannot reach A's product even with the id (8.3: 404, not 403)
    await http()
      .get(`/t/http-beta/merchant/products/${prodId}`)
      .set('Authorization', `Bearer ${merchantB}`)
      .expect(404);

    // published product: update and delete blocked (J9)
    await http()
      .patch(`/t/http-alpha/merchant/products/${prodId}`)
      .set(asA())
      .send({ name: 'New name' })
      .expect(409);
    await http().delete(`/t/http-alpha/merchant/products/${prodId}`).set(asA()).expect(409);

    // M-4: category unpublish blocked while it has a published product
    const blockedUnpub = await http()
      .post(`/t/http-alpha/merchant/categories/${catId}/unpublish`)
      .set(asA())
      .expect(409);
    expect(blockedUnpub.body.code).toBe('CATEGORY_HAS_PUBLISHED_PRODUCTS');

    await http().post(`/t/http-alpha/merchant/products/${prodId}/unpublish`).set(asA()).expect(200);
    // media references block deletion (RESTRICT); the media lifecycle removes them first
    const hasMedia = await http()
      .delete(`/t/http-alpha/merchant/products/${prodId}`)
      .set(asA())
      .expect(409);
    expect(hasMedia.body.code).toBe('PRODUCT_HAS_MEDIA');
    await su((c) => c.query('DELETE FROM media_assets WHERE product_id = $1', [prodId]));
    await http().delete(`/t/http-alpha/merchant/products/${prodId}`).set(asA()).expect(204);

    // A's list no longer leaks B's or the deleted rows
    const list = await http().get('/t/http-alpha/merchant/products').set(asA()).expect(200);
    expect(list.body).toEqual([]);
  });
});
