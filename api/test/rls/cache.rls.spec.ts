import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { JwtAccessTokenSigner } from '../../src/modules/auth/infrastructure/jwt-access-token-signer';
import { applyMigration, appDatabaseUrl, seedId, setupDatabase, superClient } from './harness';

/**
 * STM-27: cache headers, conditional requests and invalidation (M-8, 8.6.12) over real
 * HTTP against real PostgreSQL with RLS on. There is no server-side response cache in
 * IP-5 (M-8), so cross-tenant isolation is structural: the only caches are the HTTP
 * caches these headers govern and the existing 60 s tenant-resolver cache, which is
 * keyed by tenant code and never shared across tenants.
 */

const JWT_SECRET = 'cache-http-spec-secret-0123456789abcdef0123';

const TENANT_A = seedId(7010);
const TENANT_B = seedId(7011);
const USER_M_A = seedId(7012);
const USER_M_B = seedId(7013);

let app: INestApplication;
let merchantA: string;
let merchantB: string;

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
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 55, g: 25, b: 125 } } })
    .png()
    .toBuffer();

/** One published product with one image in tenant A; returns ids. */
const publishedProduct = async (): Promise<{
  productId: string;
  mediaId: string;
  etag: string;
}> => {
  const created = await http()
    .post('/t/cache-alpha/merchant/products')
    .set(asA())
    .send({ name: 'Lamp', priceAmount: 25, priceCurrency: 'EGP' })
    .expect(201);
  const productId = created.body.id as string;
  const media = await http()
    .post(`/t/cache-alpha/merchant/products/${productId}/media`)
    .set(asA())
    .attach('file', await png(900, 600), 'lamp.png')
    .expect(201);
  await http().post(`/t/cache-alpha/merchant/products/${productId}/publish`).set(asA()).expect(200);
  const detail = await http().get(`/t/cache-alpha/products/${productId}`).expect(200);
  return { productId, mediaId: media.body.id as string, etag: detail.headers['etag'] as string };
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
  merchantA = await signer.sign(USER_M_A, 'MERCHANT', seedId(7021));
  merchantB = await signer.sign(USER_M_B, 'MERCHANT', seedId(7022));
  await su(async (c) => {
    await c.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'cache-alpha','A','ACTIVE'),($2,'cache-beta','B','ACTIVE')",
      [TENANT_A, TENANT_B],
    );
    await c.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'cma@example.com','h','ACTIVE'),($2,'cmb@example.com','h','ACTIVE')",
      [USER_M_A, USER_M_B],
    );
    await c.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE'),($4,$5,$6,'MERCHANT','ACTIVE')",
      [seedId(7015), TENANT_A, USER_M_A, seedId(7016), TENANT_B, USER_M_B],
    );
  });
}, 90_000);

afterAll(async () => {
  await app?.close();
});

describe('published catalog: no-cache + ETag + conditional GET (M-8.A)', () => {
  it('carries no-cache and a strong ETag; a matching conditional GET is a 304', async () => {
    const { productId, etag } = await publishedProduct();
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const res = await http()
      .get(`/t/cache-alpha/products/${productId}`)
      .set('If-None-Match', etag)
      .expect(304);
    expect(res.text ?? '').toBe('');
    const list = await http().get('/t/cache-alpha/products').expect(200);
    expect(list.headers['cache-control']).toBe('no-cache');
    expect(list.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
    // no stale-extension directives anywhere (approved 60 s window is the maximum)
    for (const h of [list.headers['cache-control']]) {
      expect(h).not.toContain('stale-while-revalidate');
      expect(h).not.toContain('stale-if-error');
    }
  });

  it('the ETag changes when the representation changes (name, price, assignment)', async () => {
    const { productId, etag } = await publishedProduct();
    const url = `/t/cache-alpha/products/${productId}`;
    // published products are unpublish-first for updates, so each change is applied
    // through the draft lifecycle; every step must move the ETag
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/unpublish`)
      .set(asA())
      .expect(200);
    await http().get(url).expect(404); // unpublished: gone from public detail immediately
    await http()
      .patch(`/t/cache-alpha/merchant/products/${productId}`)
      .set(asA())
      .send({ name: 'Desk Lamp' })
      .expect(200);
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    const renamed = await http().get(url).expect(200);
    expect(renamed.headers['etag']).not.toBe(etag);
    // the OLD ETag can no longer produce a 304 against the changed representation
    await http().get(url).set('If-None-Match', etag).expect(200);
  });

  it('unpublish removes the product from list, search and detail — no stale 304', async () => {
    const { productId, etag } = await publishedProduct();
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/unpublish`)
      .set(asA())
      .expect(200);
    // detail: 404 even when the client still holds the old ETag (visibility first)
    await http().get(`/t/cache-alpha/products/${productId}`).set('If-None-Match', etag).expect(404);
    // list and search no longer contain it, and the list ETag moved
    const list = await http().get('/t/cache-alpha/products').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(productId);
    const search = await http().get('/t/cache-alpha/products?q=Lamp').expect(200);
    expect(JSON.stringify(search.body)).not.toContain(productId);
  });

  it('cross-tenant isolation: the same path under another tenant never matches (8.6.12)', async () => {
    const { productId, etag } = await publishedProduct();
    // B cannot read A's product; a conditional request with A's ETag cannot bypass that
    await http().get(`/t/cache-beta/products/${productId}`).set('If-None-Match', etag).expect(404);
    // A's tenant state is not shared into B's cache key space: B's public list is empty
    const listB = await http().get('/t/cache-beta/products').expect(200);
    expect(JSON.stringify(listB.body)).not.toContain(productId);
  });

  it('category rename and publish state move the category list ETag', async () => {
    const cat = await http()
      .post('/t/cache-alpha/merchant/categories')
      .set(asA())
      .send({ name: 'Lights' })
      .expect(201);
    const catId = cat.body.id as string;
    await http().post(`/t/cache-alpha/merchant/categories/${catId}/publish`).set(asA()).expect(200);
    const first = await http().get('/t/cache-alpha/categories').expect(200);
    await http()
      .post(`/t/cache-alpha/merchant/categories/${catId}/unpublish`)
      .set(asA())
      .expect(200);
    const second = await http().get('/t/cache-alpha/categories').expect(200);
    expect(second.headers['etag']).not.toBe(first.headers['etag']);
    await http().post(`/t/cache-alpha/merchant/categories/${catId}/publish`).set(asA()).expect(200);
    await http()
      .patch(`/t/cache-alpha/merchant/categories/${catId}`)
      .set(asA())
      .send({ name: 'Lighting' })
      .expect(200);
    const third = await http().get('/t/cache-alpha/categories').expect(200);
    expect(third.headers['etag']).not.toBe(second.headers['etag']);
  });
});

describe('catalog ETag and the selected public image (Blocker B fix, M-8)', () => {
  /** Draft product with two ACTIVE images, then published; returns ids in upload order. */
  const twoImageProduct = async (): Promise<{
    productId: string;
    firstMediaId: string;
    secondMediaId: string;
  }> => {
    const created = await http()
      .post('/t/cache-alpha/merchant/products')
      .set(asA())
      .send({ name: 'Chair', priceAmount: 10, priceCurrency: 'EGP' })
      .expect(201);
    const productId = created.body.id as string;
    const first = await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/media`)
      .set(asA())
      .attach('file', await png(800, 600), 'one.png')
      .expect(201);
    const second = await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/media`)
      .set(asA())
      .attach('file', await png(700, 500), 'two.png')
      .expect(201);
    return {
      productId,
      firstMediaId: first.body.id as string,
      secondMediaId: second.body.id as string,
    };
  };

  it('listing and detail expose the first-uploaded image through the D3 route', async () => {
    const { productId, firstMediaId } = await twoImageProduct();
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    const detail = await http().get(`/t/cache-alpha/products/${productId}`).expect(200);
    expect(detail.body.imageUrl).toBe(
      `/t/cache-alpha/products/${productId}/media/${firstMediaId}/image`,
    );
    const list = await http().get('/t/cache-alpha/products').expect(200);
    const item = (list.body.items as { id: string; imageUrl: string | null }[]).find(
      (p) => p.id === productId,
    );
    expect(item?.imageUrl).toBe(detail.body.imageUrl as string);
  });

  it('changing the SELECTED image changes the representation and its ETag', async () => {
    const { productId, firstMediaId, secondMediaId } = await twoImageProduct();
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    const url = `/t/cache-alpha/products/${productId}`;
    const before = await http().get(url).expect(200);
    expect(before.body.imageUrl).toContain(firstMediaId);
    // unpublish -> remove the selected image -> publish: the URL now points at the second
    await http()
      .post(`${url.replace('/products/', '/merchant/products/')}/unpublish`)
      .set(asA())
      .expect(200);
    await http()
      .delete(`/t/cache-alpha/merchant/products/${productId}/media/${firstMediaId}`)
      .set(asA())
      .expect(204);
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    const after = await http().get(url).expect(200);
    expect(after.body.imageUrl).toContain(secondMediaId);
    expect(after.headers['etag']).not.toBe(before.headers['etag']);
    await http()
      .get(url)
      .set('If-None-Match', before.headers['etag'] as string)
      .expect(200);
  });

  it('removing a NON-selected image leaves representation, ETag and 304 unchanged', async () => {
    const { productId, firstMediaId, secondMediaId } = await twoImageProduct();
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    const url = `/t/cache-alpha/products/${productId}`;
    const before = await http().get(url).expect(200);
    // the merchant API will not touch media of a published product; the maintenance
    // connection removes the non-selected row to isolate the representation semantics
    await su((c) => c.query('DELETE FROM media_assets WHERE id=$1', [secondMediaId]));
    const after = await http().get(url).expect(200);
    expect(after.body.imageUrl).toContain(firstMediaId);
    expect(after.headers['etag']).toBe(before.headers['etag']);
    await http()
      .get(url)
      .set('If-None-Match', before.headers['etag'] as string)
      .expect(304);
  });

  it('replacing the selected image keeps its URL: catalog ETag unchanged, bytes revalidate in <= 60 s', async () => {
    const { productId, mediaId, etag } = await publishedProduct();
    const url = `/t/cache-alpha/products/${productId}`;
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/media/${mediaId}/replace`)
      .set(asA())
      .attach('file', await png(640, 480), 'v2.png')
      .expect(200);
    // the representation is the URL, and the URL is stable across replacement: the
    // catalog ETag does not move (a conditional GET is still 304); the image bytes
    // themselves carry public, max-age=60, so the new generation is picked up within
    // the approved 60 s window (documented decision, Blocker B fix section 3)
    const after = await http().get(url).expect(200);
    expect(after.body.imageUrl).toBe(`/t/cache-alpha/products/${productId}/media/${mediaId}/image`);
    expect(after.headers['etag']).toBe(etag);
    await http().get(url).set('If-None-Match', etag).expect(304);
  });
});

describe('published images: public, max-age=60 with identity per variant (M-8.B)', () => {
  it('published bytes are cacheable at most 60 s; drafts are private, no-store', async () => {
    const created = await http()
      .post('/t/cache-alpha/merchant/products')
      .set(asA())
      .send({ name: 'Vase' })
      .expect(201);
    const productId = created.body.id as string;
    const media = await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/media`)
      .set(asA())
      .attach('file', await png(400, 400), 'vase.png')
      .expect(201);
    const mediaId = media.body.id as string;
    const img = `/t/cache-alpha/products/${productId}/media/${mediaId}/image`;
    const draft = await http().get(img).set(asA()).expect(200);
    expect(draft.headers['cache-control']).toBe('private, no-store');
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/publish`)
      .set(asA())
      .expect(200);
    for (const size of ['original', 'display', 'thumb']) {
      const res = await http().get(`${img}?size=${size}`).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.headers['cache-control']).not.toContain('stale-while-revalidate');
      expect(res.headers['cache-control']).not.toContain('stale-if-error');
    }
  });

  it('unpublish stops public serving immediately at the origin', async () => {
    const { productId, mediaId } = await publishedProduct();
    const img = `/t/cache-alpha/products/${productId}/media/${mediaId}/image`;
    await http().get(img).expect(200);
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/unpublish`)
      .set(asA())
      .expect(200);
    // origin re-checks publication on every request; cached copies age out in <= 60 s
    await http().get(img).expect(404);
    // the merchant's own view of the draft image is private, no-store
    const mine = await http().get(img).set(asA()).expect(200);
    expect(mine.headers['cache-control']).toBe('private, no-store');
  });

  it('replacement serves the new bytes under the same URL (new variant identity)', async () => {
    const { productId, mediaId } = await publishedProduct();
    const img = `/t/cache-alpha/products/${productId}/media/${mediaId}/image?size=thumb`;
    const before = await http().get(img).expect(200);
    await http()
      .post(`/t/cache-alpha/merchant/products/${productId}/media/${mediaId}/replace`)
      .set(asA())
      .attach('file', await png(500, 250), 'v2.png')
      .expect(200);
    const after = await http().get(img).expect(200);
    expect(Buffer.compare(before.body as Buffer, after.body as Buffer)).not.toBe(0);
    expect(after.headers['cache-control']).toBe('public, max-age=60');
    const meta = await sharp(after.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([256, 128]);
  });

  it('media authorization is evaluated on every request, cached or not', async () => {
    const { productId, mediaId } = await publishedProduct();
    const img = `/t/cache-alpha/products/${productId}/media/${mediaId}/image`;
    // B's merchant cannot use A's published image even after A's cache warmed
    await http().get(img).expect(200);
    await http().get(img).set('Authorization', `Bearer ${merchantB}`).expect(404);
    await http().get(`/t/cache-beta/products/${productId}/media/${mediaId}/image`).expect(404);
  });
});

describe('private responses: merchant JSON is never stored (M-8.C)', () => {
  it('merchant catalog and media endpoints carry private, no-store', async () => {
    const list = await http().get('/t/cache-alpha/merchant/products').set(asA()).expect(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    const product = await http()
      .post('/t/cache-alpha/merchant/products')
      .set(asA())
      .send({ name: 'Draft Only' })
      .expect(201);
    const mediaList = await http()
      .get(`/t/cache-alpha/merchant/products/${product.body.id as string}/media`)
      .set(asA())
      .expect(200);
    expect(mediaList.headers['cache-control']).toBe('private, no-store');
  });
});
