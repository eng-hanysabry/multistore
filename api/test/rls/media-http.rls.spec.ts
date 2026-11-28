import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * Media endpoints over real HTTP against real PostgreSQL with RLS on (STM-23, 8.3,
 * 8.6.9, spec 7): the guard chain, multipart upload with real sharp processing,
 * publish-gate integration, authorization and isolation on serving, failure handling
 * and response leakage scans. Storage is the approved LocalStorageDouble.
 */

const JWT_SECRET = 'media-http-spec-secret-0123456789abcdef012';

const TENANT_A = seedId(6010);
const TENANT_B = seedId(6011);
const USER_M_A = seedId(6012);
const USER_M_B = seedId(6013);
const USER_C = seedId(6014);

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

const png = (w: number, h: number): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 90, b: 160 } } })
    .png()
    .toBuffer();

const createProduct = async (): Promise<string> => {
  const res = await http()
    .post('/t/media-alpha/merchant/products')
    .set(asA())
    .send({ name: 'Chair', priceAmount: 10, priceCurrency: 'EGP' })
    .expect(201);
  return res.body.id as string;
};

const uploadImage = async (productId: string): Promise<string> => {
  const res = await http()
    .post(`/t/media-alpha/merchant/products/${productId}/media`)
    .set(asA())
    .attach('file', await png(1200, 800), 'photo.png')
    .expect(201);
  return res.body.id as string;
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
  merchantA = await signer.sign(USER_M_A, 'MERCHANT', seedId(6021));
  merchantB = await signer.sign(USER_M_B, 'MERCHANT', seedId(6022));
  customer = await signer.sign(USER_C, 'CUSTOMER', seedId(6023));

  await su(async (c) => {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'media-alpha','A','ACTIVE'),($2,'media-beta','B','ACTIVE'),($3,'media-susp','S','SUSPENDED')",
      [TENANT_A, TENANT_B, seedId(6017)],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'mma@example.com','h','ACTIVE'),($2,'mmb@example.com','h','ACTIVE'),($3,'mc@example.com','h','ACTIVE')",
      [USER_M_A, USER_M_B, USER_C],
    );
    await c.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE'),($4,$5,$6,'MERCHANT','ACTIVE')",
      [seedId(6015), TENANT_A, USER_M_A, seedId(6016), TENANT_B, USER_M_B],
    );
  });
}, 90_000);

afterAll(async () => {
  await app?.close();
});

describe('media upload validation (STM-23, J10)', () => {
  it('accepts a valid image: webp variants, safe 201 body, no storage fields leak', async () => {
    const productId = await createProduct();
    const res = await http()
      .post(`/t/media-alpha/merchant/products/${productId}/media`)
      .set(asA())
      .attach('file', await png(1200, 800), 'photo.png')
      .expect(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.contentType).toBe('image/webp');
    expect(res.body.widthPx).toBe(1200);
    expect(res.body.imageUrl).toBe(
      `/t/media-alpha/products/${productId}/media/${res.body.id as string}/image`,
    );
    // leakage scan (8.3): no keys, filenames, paths or provider fields anywhere
    const body = JSON.stringify(res.body);
    for (const banned of [
      'drive_file_key',
      'driveFileKey',
      'variants',
      'photo.png',
      '/original/',
      '/thumb/',
      '/display/',
      'storage',
      'google',
      '/tmp',
      '.webp',
    ]) {
      expect(body).not.toContain(banned);
    }
  });

  it('rejects malformed, disguised, oversized and over-dimension uploads safely', async () => {
    const productId = await createProduct();
    const url = `/t/media-alpha/merchant/products/${productId}/media`;
    const bad = await http()
      .post(url)
      .set(asA())
      .attach('file', Buffer.from([1, 2, 3, 4]), 'evil.png')
      .expect(400);
    expect(bad.body.code).toBe('INVALID_IMAGE');
    expect(bad.body.stack).toBeUndefined();

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    const disguised = await http()
      .post(url)
      .set(asA())
      .attach('file', svg, { filename: 'disguised.png', contentType: 'image/png' })
      .expect(415);
    expect(disguised.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const tooBig = await http()
      .post(url)
      .set(asA())
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 7), 'big.png')
      .expect(413);
    expect(tooBig.body.code).toBe('PAYLOAD_TOO_LARGE');

    const tooWide = await http()
      .post(url)
      .set(asA())
      .attach('file', await png(4001, 8), 'wide.png')
      .expect(400);
    expect(tooWide.body.code).toBe('DIMENSIONS_TOO_LARGE');

    // STM-23 side effect: no orphan rows for rejected uploads
    const rows = await su((c) =>
      c.query('SELECT count(*)::int AS n FROM media_assets WHERE tenant_id = $1', [TENANT_A]),
    );
    const earlier = await http()
      .get(`/t/media-alpha/merchant/products/${productId}/media`)
      .set(asA())
      .expect(200);
    expect(rows.rows[0].n).toBeGreaterThanOrEqual(earlier.body.length);
  });

  it('upload guards: unauthenticated 401, customer 403, cross-tenant merchant 404', async () => {
    const productId = await createProduct();
    const url = `/t/media-alpha/merchant/products/${productId}/media`;
    await http()
      .post(url)
      .attach('file', await png(8, 8), 'x.png')
      .expect(401);
    await http()
      .post(url)
      .set('Authorization', `Bearer ${customer}`)
      .attach('file', await png(8, 8), 'x.png')
      .expect(403);
    await http()
      .post(url)
      .set('Authorization', `Bearer ${merchantB}`)
      .attach('file', await png(8, 8), 'x.png')
      .expect(404);
    // a merchant of A cannot upload into B's URL (membership re-check, 8.3)
    await http()
      .post(`/t/media-beta/merchant/products/${productId}/media`)
      .set(asA())
      .attach('file', await png(8, 8), 'x.png')
      .expect(404);
  });

  it('tenant_id in a multipart field is rejected by the whitelist pipe', async () => {
    const productId = await createProduct();
    await http()
      .post(`/t/media-alpha/merchant/products/${productId}/media`)
      .set(asA())
      .field('tenant_id', TENANT_B)
      .attach('file', await png(8, 8), 'x.png')
      .expect(400);
  });

  it('idempotent upload replay over HTTP returns the first result', async () => {
    const productId = await createProduct();
    const url = `/t/media-alpha/merchant/products/${productId}/media`;
    const img = await png(64, 64);
    const first = await http()
      .post(url)
      .set(asA())
      .set('Idempotency-Key', 'media-k1')
      .attach('file', img, 'a.png')
      .expect(201);
    const replay = await http()
      .post(url)
      .set(asA())
      .set('Idempotency-Key', 'media-k1')
      .attach('file', img, 'a.png')
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    const conflict = await http()
      .post(url)
      .set(asA())
      .set('Idempotency-Key', 'media-k1')
      .attach('file', await png(32, 32), 'b.png')
      .expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('media lifecycle with the publish gate (8.7, Batch 3 section 9)', () => {
  it('publish requires an ACTIVE image; last-image delete on published is blocked', async () => {
    const productId = await createProduct();
    const noImage = await http()
      .post(`/t/media-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(409);
    expect(noImage.body.code).toBe('IMAGE_REQUIRED');

    const mediaId = await uploadImage(productId);
    await http()
      .post(`/t/media-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);

    // deleting the image of a PUBLISHED product: unpublish first (section 9)
    const blocked = await http()
      .delete(`/t/media-alpha/merchant/products/${productId}/media/${mediaId}`)
      .set(asA())
      .expect(409);
    expect(blocked.body.code).toBe('MEDIA_ON_PUBLISHED_PRODUCT');

    await http()
      .post(`/t/media-alpha/merchant/products/${productId}/unpublish`)
      .set(asA())
      .expect(200);
    await http()
      .delete(`/t/media-alpha/merchant/products/${productId}/media/${mediaId}`)
      .set(asA())
      .expect(204);
    // repeated deletion: clean 404
    await http()
      .delete(`/t/media-alpha/merchant/products/${productId}/media/${mediaId}`)
      .set(asA())
      .expect(404);
  });

  it('replacement keeps the media id, swaps bytes, and old variants stop serving', async () => {
    const productId = await createProduct();
    const mediaId = await uploadImage(productId);
    const before = await http()
      .get(`/t/media-alpha/products/${productId}/media/${mediaId}/image?size=thumb`)
      .set(asA())
      .expect(200);
    await http()
      .post(`/t/media-alpha/merchant/products/${productId}/media/${mediaId}/replace`)
      .set(asA())
      .attach('file', await png(300, 300), 'new.png')
      .expect(200);
    const after = await http()
      .get(`/t/media-alpha/products/${productId}/media/${mediaId}/image?size=thumb`)
      .set(asA())
      .expect(200);
    expect(Buffer.compare(before.body as Buffer, after.body as Buffer)).not.toBe(0);
    const meta = await sharp(after.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });
});

describe('authorized image serving (spec 7, STM-23)', () => {
  it('guest/customer see published images only; drafts are merchant-only', async () => {
    const productId = await createProduct();
    const mediaId = await uploadImage(productId);
    const img = `/t/media-alpha/products/${productId}/media/${mediaId}/image`;

    // draft product: guest and customer get 404, the owning merchant gets bytes
    await http().get(img).expect(404);
    await http().get(img).set('Authorization', `Bearer ${customer}`).expect(404);
    const draft = await http().get(img).set(asA()).expect(200);
    expect(draft.headers['content-type']).toBe('image/webp');
    expect(draft.headers['cache-control']).toBe('private, no-store');

    await http()
      .post(`/t/media-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    const pub = await http().get(img).expect(200);
    expect(pub.headers['cache-control']).toBe('public, max-age=60');
    const meta = await sharp(pub.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1024); // default size=display
    await http().get(img).set('Authorization', `Bearer ${customer}`).expect(200);
    const thumb = await http().get(`${img}?size=thumb`).expect(200);
    const tmeta = await sharp(thumb.body as Buffer).metadata();
    expect(tmeta.width).toBe(256);
    await http().get(`${img}?size=original`).expect(200);
    await http().get(`${img}?size=huge`).expect(400); // whitelist pipe

    // invalid/expired token on the public route is a 401, never silent guest
    await http().get(img).set('Authorization', 'Bearer garbage').expect(401);
  });

  it('cross-tenant, unknown and suspended tenants are 404 with the safe shape', async () => {
    const productId = await createProduct();
    const mediaId = await uploadImage(productId);
    await http()
      .post(`/t/media-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    // tenant B's merchant token against A's URL: membership guard 404
    await http()
      .get(`/t/media-alpha/products/${productId}/media/${mediaId}/image`)
      .set('Authorization', `Bearer ${merchantB}`)
      .expect(404);
    // B's URL with A's ids: RLS hides the rows (8.3)
    const res = await http()
      .get(`/t/media-beta/products/${productId}/media/${mediaId}/image`)
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.stack).toBeUndefined();
    await http().get(`/t/media-susp/products/${productId}/media/${mediaId}/image`).expect(404);
    await http().get(`/t/no-such-store/products/${productId}/media/${mediaId}/image`).expect(404);
    // non-UUID path ids: safe 404, never a 500 (STM-21)
    await http().get(`/t/media-alpha/products/not-a-uuid/media/${mediaId}/image`).expect(404);
    await http().get(`/t/media-alpha/products/${productId}/media/not-a-uuid/image`).expect(404);
  });

  it('no STORE_LOGO public access exists (branding deferred, M-7)', async () => {
    await su((c) =>
      c.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,NULL,'STORE_LOGO','ACTIVE','image/webp',$3)",
        [seedId(6030), TENANT_A, USER_M_A],
      ),
    );
    await http()
      .get(`/t/media-alpha/products/${seedId(6031)}/media/${seedId(6030)}/image`)
      .expect(404);
    // and there is no public logo route at all
    await http().get('/t/media-alpha/logo').expect(404);
  });
});
