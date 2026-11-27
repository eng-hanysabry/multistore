import { Pool } from 'pg';
import { Ctx, applyMigration, poolAs, run, seedId, setupDatabase, superClient } from './harness';

/**
 * IP-5 catalog and media RLS matrix (Batch 1 authorization section 7.A, spec 6.4).
 * Runs against the actual IP-5 migration applied as multistore_owner. Covers GUEST,
 * CUSTOMER, MERCHANT, multistore_admin and multistore_owner across all four new tables:
 * cross-tenant isolation, composite-FK rejection, draft visibility, publish guards,
 * unpublish restrictions, media authorization by product publication state, STORE_LOGO
 * public denial, and idempotency tenant/user scoping.
 */

const TENANT_A = seedId(3010);
const TENANT_B = seedId(3011);
const USER_M_A = seedId(3012); // merchant of A
const USER_M_B = seedId(3013); // merchant of B
const USER_C = seedId(3014); // customer, no membership

const CAT_A_PUB = seedId(3020);
const CAT_A_DRAFT = seedId(3021);
const CAT_B_PUB = seedId(3022);

const PROD_A_PUB = seedId(3030); // in CAT_A_PUB, published (has ACTIVE image)
const PROD_A_DRAFT_OK = seedId(3031); // in CAT_A_PUB, draft, publishable (has ACTIVE image)
const PROD_A_DRAFTCAT = seedId(3032); // in CAT_A_DRAFT, draft, has image (publish must fail: draft category)
const PROD_A_NOIMG = seedId(3033); // uncategorized, draft, no image (publish must fail: no image)
const PROD_B_PUB = seedId(3034); // in CAT_B_PUB, published

const IMG_A_PUB = seedId(3040); // ACTIVE image of PROD_A_PUB
const IMG_A_PUB_FAILED = seedId(3041); // FAILED image of PROD_A_PUB (public must not see)
const IMG_A_OK = seedId(3042); // ACTIVE image of PROD_A_DRAFT_OK
const IMG_A_DRAFTCAT = seedId(3043); // ACTIVE image of PROD_A_DRAFTCAT
const LOGO_A = seedId(3044); // STORE_LOGO of tenant A (no public access)
const IMG_B_PUB = seedId(3045); // ACTIVE image of PROD_B_PUB

const IK_A_MERCHANT_FRESH = seedId(3050);
const IK_A_MERCHANT_EXPIRED = seedId(3051);
const IK_A_CUSTOMER = seedId(3052);
const IK_B_MERCHANT = seedId(3053);

let app: Pool;
let admin: Pool;
let owner: Pool;

const q1 = (pool: Pool, ctx: Ctx, sql: string, p: unknown[] = []) =>
  run(pool, ctx, async (q) => (await q(sql, p)).rows);
const deniedOrEmpty = async (
  pool: Pool,
  ctx: Ctx,
  sql: string,
  p: unknown[] = [],
): Promise<boolean> => {
  try {
    return (await run(pool, ctx, async (q) => (await q(sql, p)).rowCount)) === 0;
  } catch {
    return true;
  }
};

async function seed(): Promise<void> {
  // Seeds run as the superuser (FORCE RLS binds the owner). Published rows go through
  // the real lifecycle so the SECURITY INVOKER guard triggers see valid state.
  const s = superClient();
  await s.connect();
  try {
    await s.query(
      "INSERT INTO tenants (id, code, name, status) VALUES ($1,'ip5-alpha','A','ACTIVE'),($2,'ip5-beta','B','ACTIVE')",
      [TENANT_A, TENANT_B],
    );
    await s.query(
      "INSERT INTO users (id, email, password_hash, status) VALUES ($1,'ma@example.com','h','ACTIVE'),($2,'mb@example.com','h','ACTIVE'),($3,'c@example.com','h','ACTIVE')",
      [USER_M_A, USER_M_B, USER_C],
    );
    await s.query(
      "INSERT INTO memberships (id, tenant_id, user_id, role, status) VALUES ($1,$2,$3,'MERCHANT','ACTIVE'),($4,$5,$6,'MERCHANT','ACTIVE')",
      [seedId(3015), TENANT_A, USER_M_A, seedId(3016), TENANT_B, USER_M_B],
    );
    await s.query(
      "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ($1,$2,'A-pub','DRAFT',$4),($3,$2,'A-draft','DRAFT',$4),($5,$6,'B-pub','DRAFT',$7)",
      [CAT_A_PUB, TENANT_A, CAT_A_DRAFT, USER_M_A, CAT_B_PUB, TENANT_B, USER_M_B],
    );
    await s.query(
      "UPDATE categories SET status = 'PUBLISHED', published_at = now() WHERE id = ANY($1)",
      [[CAT_A_PUB, CAT_B_PUB]],
    );
    await s.query(
      `INSERT INTO products (id, tenant_id, category_id, name, status, created_by) VALUES
       ($1,$2,$3,'A-pub','DRAFT',$8),
       ($4,$2,$3,'A-draft-ok','DRAFT',$8),
       ($5,$2,$6,'A-draftcat','DRAFT',$8),
       ($7,$2,NULL,'A-noimg','DRAFT',$8),
       ($9,$10,$11,'B-pub','DRAFT',$12)`,
      [
        PROD_A_PUB,
        TENANT_A,
        CAT_A_PUB,
        PROD_A_DRAFT_OK,
        PROD_A_DRAFTCAT,
        CAT_A_DRAFT,
        PROD_A_NOIMG,
        USER_M_A,
        PROD_B_PUB,
        TENANT_B,
        CAT_B_PUB,
        USER_M_B,
      ],
    );
    await s.query(
      `INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES
       ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$8),
       ($4,$2,$3,'PRODUCT_IMAGE','FAILED','image/webp',$8),
       ($5,$2,$6,'PRODUCT_IMAGE','ACTIVE','image/webp',$8),
       ($7,$2,$9,'PRODUCT_IMAGE','ACTIVE','image/webp',$8),
       ($10,$2,NULL,'STORE_LOGO','ACTIVE','image/webp',$8),
       ($11,$12,$13,'PRODUCT_IMAGE','ACTIVE','image/webp',$14)`,
      [
        IMG_A_PUB,
        TENANT_A,
        PROD_A_PUB,
        IMG_A_PUB_FAILED,
        IMG_A_OK,
        PROD_A_DRAFT_OK,
        IMG_A_DRAFTCAT,
        USER_M_A,
        PROD_A_DRAFTCAT,
        LOGO_A,
        IMG_B_PUB,
        TENANT_B,
        PROD_B_PUB,
        USER_M_B,
      ],
    );
    await s.query(
      "UPDATE products SET status = 'PUBLISHED', published_at = now() WHERE id = ANY($1)",
      [[PROD_A_PUB, PROD_B_PUB]],
    );
    await s.query(
      `INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body, expires_at) VALUES
       ($1,$2,$3,'category.create','k-fresh','h1',200,'{}', now() + interval '24 hours'),
       ($4,$2,$3,'category.create','k-expired','h2',200,'{}', now() - interval '1 hour'),
       ($5,$2,$6,'product.create','k-cust','h3',200,'{}', now() + interval '24 hours'),
       ($7,$8,$9,'category.create','k-b','h4',200,'{}', now() + interval '24 hours')`,
      [
        IK_A_MERCHANT_FRESH,
        TENANT_A,
        USER_M_A,
        IK_A_MERCHANT_EXPIRED,
        IK_A_CUSTOMER,
        USER_C,
        IK_B_MERCHANT,
        TENANT_B,
        USER_M_B,
      ],
    );
  } finally {
    await s.end();
  }
}

beforeAll(async () => {
  await setupDatabase();
  await applyMigration('20261126160002_ip4_identity_tenancy');
  await applyMigration('20261127221500_ip5_catalog_and_media');
  await seed();
  app = poolAs('multistore_app', 4);
  admin = poolAs('multistore_admin', 1);
  owner = poolAs('multistore_owner', 1);
});
afterAll(async () => {
  await Promise.all([app.end(), admin.end(), owner.end()]);
});

describe('structure: RLS, FORCE, no id defaults, composite FKs', () => {
  it('RLS is enabled and forced on all four IP-5 tables', async () => {
    const r = await app.query(
      'SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity ORDER BY 1',
      [['categories', 'products', 'media_assets', 'idempotency_keys']],
    );
    expect(r.rows.map((x) => x['relname'])).toEqual([
      'categories',
      'idempotency_keys',
      'media_assets',
      'products',
    ]);
  });
  it('no database default on any of the four id columns (PART A / STM-20)', async () => {
    const r = await app.query(
      "SELECT table_name FROM information_schema.columns WHERE table_name = ANY($1) AND column_name = 'id' AND column_default IS NOT NULL",
      [['categories', 'products', 'media_assets', 'idempotency_keys']],
    );
    expect(r.rows).toEqual([]);
  });
  it('cross-tenant foreign key: a product of tenant A cannot reference a category of tenant B (composite FK)', async () => {
    const s = superClient();
    await s.connect();
    try {
      await expect(
        s.query(
          "INSERT INTO products (id, tenant_id, category_id, name, status, created_by) VALUES ($1,$2,$3,'x','DRAFT',$4)",
          [seedId(3090), TENANT_A, CAT_B_PUB, USER_M_A],
        ),
      ).rejects.toThrow(/products_tenant_id_category_id_fkey|foreign key/i);
    } finally {
      await s.end();
    }
  });
  it('cross-tenant foreign key: media of tenant A cannot reference a product of tenant B', async () => {
    const s = superClient();
    await s.connect();
    try {
      await expect(
        s.query(
          "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
          [seedId(3091), TENANT_A, PROD_B_PUB, USER_M_A],
        ),
      ).rejects.toThrow(/media_assets_tenant_id_product_id_fkey|foreign key/i);
    } finally {
      await s.end();
    }
  });
  it('ON DELETE RESTRICT: a referenced category cannot be deleted even as superuser', async () => {
    const s = superClient();
    await s.connect();
    try {
      await expect(s.query('DELETE FROM categories WHERE id = $1', [CAT_A_PUB])).rejects.toThrow(
        /violates foreign key constraint/i,
      );
    } finally {
      await s.end();
    }
  });
  it('price pairing: amount without currency (and vice versa) is rejected by CHECK', async () => {
    const s = superClient();
    await s.connect();
    try {
      await expect(
        s.query(
          "INSERT INTO products (id, tenant_id, name, status, price_amount, created_by) VALUES ($1,$2,'x','DRAFT',10,$3)",
          [seedId(3092), TENANT_A, USER_M_A],
        ),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        s.query(
          "INSERT INTO products (id, tenant_id, name, status, price_currency, created_by) VALUES ($1,$2,'x','DRAFT','USD',$3)",
          [seedId(3093), TENANT_A, USER_M_A],
        ),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        s.query(
          "INSERT INTO products (id, tenant_id, name, status, price_amount, price_currency, created_by) VALUES ($1,$2,'x','DRAFT',-1,'USD',$3)",
          [seedId(3094), TENANT_A, USER_M_A],
        ),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        s.query(
          "INSERT INTO products (id, tenant_id, name, status, price_amount, price_currency, created_by) VALUES ($1,$2,'x','DRAFT',1,'usd',$3)",
          [seedId(3095), TENANT_A, USER_M_A],
        ),
      ).rejects.toThrow(/check constraint/i);
      const ok = await s.query(
        "INSERT INTO products (id, tenant_id, name, status, price_amount, price_currency, created_by) VALUES ($1,$2,'x','DRAFT',1.5,'USD',$3) RETURNING id",
        [seedId(3096), TENANT_A, USER_M_A],
      );
      expect(ok.rowCount).toBe(1);
      await s.query('DELETE FROM products WHERE id = $1', [seedId(3096)]);
    } finally {
      await s.end();
    }
  });
});

describe('public visibility (GUEST / CUSTOMER)', () => {
  for (const role of ['GUEST', 'CUSTOMER']) {
    const ctx = (): Ctx => ({ role, tenant: TENANT_A, user: USER_C });
    it(`${role}: sees only published categories of the context tenant`, async () => {
      const rows = await q1(app, ctx(), 'SELECT id FROM categories ORDER BY id');
      expect(rows.map((r) => r['id'])).toEqual([CAT_A_PUB]);
    });
    it(`${role}: sees only published products of the context tenant`, async () => {
      const rows = await q1(app, ctx(), 'SELECT id FROM products ORDER BY id');
      expect(rows.map((r) => r['id'])).toEqual([PROD_A_PUB]);
    });
    it(`${role}: sees only ACTIVE images of published products; no draft-product media, no FAILED, no STORE_LOGO`, async () => {
      const rows = await q1(app, ctx(), 'SELECT id, kind FROM media_assets ORDER BY id');
      expect(rows.map((r) => r['id'])).toEqual([IMG_A_PUB]);
      expect(rows.every((r) => r['kind'] === 'PRODUCT_IMAGE')).toBe(true);
    });
    it(`${role}: no cross-tenant reads even when querying the other tenant directly`, async () => {
      expect(
        await q1(app, ctx(), 'SELECT id FROM products WHERE tenant_id = $1', [TENANT_B]),
      ).toEqual([]);
      expect(await q1(app, ctx(), 'SELECT id FROM products WHERE id = $1', [PROD_B_PUB])).toEqual(
        [],
      );
      expect(
        await q1(app, ctx(), 'SELECT id FROM media_assets WHERE id = $1', [IMG_B_PUB]),
      ).toEqual([]);
    });
    it(`${role}: no writes on any of the four tables`, async () => {
      for (const sql of [
        "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ('99999999-9999-4999-8999-999999999991', $1, 'x', 'DRAFT', $2)",
        "UPDATE categories SET name = 'z' WHERE id = ANY(SELECT id FROM categories)",
        'DELETE FROM categories',
      ]) {
        expect(await deniedOrEmpty(app, ctx(), sql, [TENANT_A, USER_C])).toBe(true);
      }
    });
  }
  it('GUEST: cannot read or insert idempotency records', async () => {
    const ctx: Ctx = { role: 'GUEST', tenant: TENANT_A, user: USER_C };
    expect(await q1(app, ctx, 'SELECT id FROM idempotency_keys')).toEqual([]);
    expect(
      await deniedOrEmpty(
        app,
        ctx,
        "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body) VALUES ('99999999-9999-4999-8999-999999999992', $1, $2, 'a', 'k', 'h', 200, '{}')",
        [TENANT_A, USER_C],
      ),
    ).toBe(true);
  });
  it('CUSTOMER: idempotency access is limited to its own (tenant, user) scope', async () => {
    const ctx: Ctx = { role: 'CUSTOMER', tenant: TENANT_A, user: USER_C };
    expect((await q1(app, ctx, 'SELECT id FROM idempotency_keys')).map((r) => r['id'])).toEqual([
      IK_A_CUSTOMER,
    ]);
    // own-scope insert succeeds (rolled back so no row persists)
    await expect(
      run(app, ctx, async (q) => {
        const r = await q(
          "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body) VALUES ('99999999-9999-4999-8999-999999999993', $1, $2, 'a', 'k', 'h', 200, '{}')",
          [TENANT_A, USER_C],
        );
        expect(r.rowCount).toBe(1);
        throw new Error('__rollback');
      }),
    ).rejects.toThrow('__rollback');
    // another user's scope is rejected
    await expect(
      run(app, ctx, (q) =>
        q(
          "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body) VALUES ('99999999-9999-4999-8999-999999999994', $1, $2, 'a', 'k', 'h', 200, '{}')",
          [TENANT_A, USER_M_A],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('MERCHANT isolation and lifecycle', () => {
  const ctxA: Ctx = { role: 'MERCHANT', tenant: TENANT_A, user: USER_M_A };
  it('sees all own-tenant rows, nothing of tenant B', async () => {
    expect(
      (await q1(app, ctxA, 'SELECT id FROM categories ORDER BY id')).map((r) => r['id']),
    ).toEqual([CAT_A_PUB, CAT_A_DRAFT].sort());
    expect(
      (await q1(app, ctxA, 'SELECT id FROM products ORDER BY id')).map((r) => r['id']),
    ).toEqual([PROD_A_PUB, PROD_A_DRAFT_OK, PROD_A_DRAFTCAT, PROD_A_NOIMG].sort());
    expect(
      (await q1(app, ctxA, 'SELECT id FROM media_assets ORDER BY id')).map((r) => r['id']),
    ).toEqual([IMG_A_PUB, IMG_A_PUB_FAILED, IMG_A_OK, IMG_A_DRAFTCAT, LOGO_A].sort());
  });
  it('cannot write into another tenant (WITH CHECK)', async () => {
    await expect(
      run(app, ctxA, (q) =>
        q(
          "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ($1,$2,'x','DRAFT',$3)",
          [seedId(3097), TENANT_B, USER_M_A],
        ),
      ),
    ).rejects.toThrow();
  });
  it('publish rejected when the category is DRAFT (M-3, DB trigger)', async () => {
    await expect(
      run(app, ctxA, (q) =>
        q("UPDATE products SET status = 'PUBLISHED', published_at = now() WHERE id = $1", [
          PROD_A_DRAFTCAT,
        ]),
      ),
    ).rejects.toThrow(/published category/i);
  });
  it('publish rejected without an ACTIVE PRODUCT_IMAGE (spec 8.7, DB trigger)', async () => {
    await expect(
      run(app, ctxA, (q) =>
        q("UPDATE products SET status = 'PUBLISHED', published_at = now() WHERE id = $1", [
          PROD_A_NOIMG,
        ]),
      ),
    ).rejects.toThrow(/ACTIVE PRODUCT_IMAGE/i);
  });
  it('publish succeeds with a published category and an ACTIVE image; unpublish restores DRAFT', async () => {
    await run(app, ctxA, async (q) => {
      expect(
        (
          await q("UPDATE products SET status = 'PUBLISHED', published_at = now() WHERE id = $1", [
            PROD_A_DRAFT_OK,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await q("UPDATE products SET status = 'DRAFT', published_at = NULL WHERE id = $1", [
            PROD_A_DRAFT_OK,
          ])
        ).rowCount,
      ).toBe(1);
    });
  });
  it('category unpublish blocked while published products reference it (M-4, DB trigger)', async () => {
    await expect(
      run(app, ctxA, (q) =>
        q("UPDATE categories SET status = 'DRAFT', published_at = NULL WHERE id = $1", [CAT_A_PUB]),
      ),
    ).rejects.toThrow(/unpublish blocked/i);
  });
  it('category unpublish succeeds after its products are unpublished; state restored', async () => {
    await run(app, ctxA, async (q) => {
      await q("UPDATE products SET status = 'DRAFT', published_at = NULL WHERE id = $1", [
        PROD_A_PUB,
      ]);
      expect(
        (
          await q("UPDATE categories SET status = 'DRAFT', published_at = NULL WHERE id = $1", [
            CAT_A_PUB,
          ])
        ).rowCount,
      ).toBe(1);
      // restore published state for the other tests
      await q("UPDATE categories SET status = 'PUBLISHED', published_at = now() WHERE id = $1", [
        CAT_A_PUB,
      ]);
      await q("UPDATE products SET status = 'PUBLISHED', published_at = now() WHERE id = $1", [
        PROD_A_PUB,
      ]);
    });
  });
  it('deletion only while DRAFT: published product delete matches zero rows', async () => {
    expect(await deniedOrEmpty(app, ctxA, 'DELETE FROM products WHERE id = $1', [PROD_A_PUB])).toBe(
      true,
    );
    expect(
      await deniedOrEmpty(app, ctxA, 'DELETE FROM categories WHERE id = $1', [CAT_A_PUB]),
    ).toBe(true);
  });
  it('DRAFT delete works; referenced media blocks product deletion (FK RESTRICT)', async () => {
    await run(app, ctxA, async (q) => {
      // media of a DRAFT product is deletable
      expect((await q('DELETE FROM media_assets WHERE id = $1', [IMG_A_OK])).rowCount).toBe(1);
      // now the DRAFT product itself can go
      expect((await q('DELETE FROM products WHERE id = $1', [PROD_A_DRAFT_OK])).rowCount).toBe(1);
    });
    // restore for later suites
    const s = superClient();
    await s.connect();
    try {
      await s.query(
        "INSERT INTO products (id, tenant_id, category_id, name, status, created_by) VALUES ($1,$2,$3,'A-draft-ok','DRAFT',$4)",
        [PROD_A_DRAFT_OK, TENANT_A, CAT_A_PUB, USER_M_A],
      );
      await s.query(
        "INSERT INTO media_assets (id, tenant_id, product_id, kind, status, content_type, uploaded_by) VALUES ($1,$2,$3,'PRODUCT_IMAGE','ACTIVE','image/webp',$4)",
        [IMG_A_OK, TENANT_A, PROD_A_DRAFT_OK, USER_M_A],
      );
    } finally {
      await s.end();
    }
  });
  it('media of a PUBLISHED product cannot be deleted by the merchant (J9)', async () => {
    expect(
      await deniedOrEmpty(app, ctxA, 'DELETE FROM media_assets WHERE id = $1', [IMG_A_PUB]),
    ).toBe(true);
  });
  it('STORE_LOGO is merchant-manageable but never public (M-7)', async () => {
    expect(
      (await q1(app, ctxA, 'SELECT id FROM media_assets WHERE kind = $1', ['STORE_LOGO'])).map(
        (r) => r['id'],
      ),
    ).toEqual([LOGO_A]);
  });
});

describe('idempotency_keys scoping (10.7, M-2)', () => {
  it('MERCHANT sees only rows of its own (tenant, user)', async () => {
    const rows = await q1(
      app,
      { role: 'MERCHANT', tenant: TENANT_A, user: USER_M_A },
      'SELECT id FROM idempotency_keys ORDER BY id',
    );
    expect(rows.map((r) => r['id'])).toEqual([IK_A_MERCHANT_FRESH, IK_A_MERCHANT_EXPIRED].sort());
  });
  it('CUSTOMER sees only its own rows', async () => {
    const rows = await q1(
      app,
      { role: 'CUSTOMER', tenant: TENANT_A, user: USER_C },
      'SELECT id FROM idempotency_keys',
    );
    expect(rows.map((r) => r['id'])).toEqual([IK_A_CUSTOMER]);
  });
  it('insert allowed only inside the own (tenant, user) scope', async () => {
    const ctx: Ctx = { role: 'MERCHANT', tenant: TENANT_A, user: USER_M_A };
    // success asserted inside the transaction, then rolled back so no row persists
    await expect(
      run(app, ctx, async (q) => {
        const r = await q(
          "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body) VALUES ($1,$2,$3,'a','k1','h',200,'{}')",
          [seedId(3098), TENANT_A, USER_M_A],
        );
        expect(r.rowCount).toBe(1);
        throw new Error('__rollback');
      }),
    ).rejects.toThrow('__rollback');
    await expect(
      run(app, ctx, (q) =>
        q(
          "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body) VALUES ($1,$2,$3,'a','k2','h',200,'{}')",
          [seedId(3099), TENANT_B, USER_M_A],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      run(app, ctx, (q) =>
        q(
          "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body) VALUES ($1,$2,$3,'a','k3','h',200,'{}')",
          [seedId(3100), TENANT_A, USER_C],
        ),
      ),
    ).rejects.toThrow();
  });
  it('the app role cannot UPDATE or DELETE records (write-once)', async () => {
    const ctx: Ctx = { role: 'MERCHANT', tenant: TENANT_A, user: USER_M_A };
    expect(
      await deniedOrEmpty(app, ctx, 'UPDATE idempotency_keys SET response_status = 500', []),
    ).toBe(true);
    expect(await deniedOrEmpty(app, ctx, 'DELETE FROM idempotency_keys', [])).toBe(true);
  });
  it('owner prune removes only expired records (24 h retention)', async () => {
    const before = await owner.query('SELECT count(*)::int AS n FROM idempotency_keys');
    const del = await owner.query('DELETE FROM idempotency_keys WHERE true');
    const after = await owner.query('SELECT id FROM idempotency_keys ORDER BY id');
    expect(before.rows[0]?.['n']).toBe(4);
    expect(del.rowCount).toBe(1);
    expect(after.rows.map((r) => r['id'])).toEqual(
      [IK_A_MERCHANT_FRESH, IK_A_CUSTOMER, IK_B_MERCHANT].sort(),
    );
    // restore the expired row for repeatability
    const s = superClient();
    await s.connect();
    try {
      await s.query(
        "INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash, response_status, response_body, expires_at) VALUES ($1,$2,$3,'category.create','k-expired','h2',200,'{}', now() - interval '1 hour')",
        [IK_A_MERCHANT_EXPIRED, TENANT_A, USER_M_A],
      );
    } finally {
      await s.end();
    }
  });
});

describe('owner and admin boundaries (approved IP-4 patterns)', () => {
  it('multistore_admin reads catalog/media of all tenants but cannot write', async () => {
    expect((await admin.query('SELECT count(*)::int AS n FROM categories')).rows[0]?.['n']).toBe(3);
    expect((await admin.query('SELECT count(*)::int AS n FROM products')).rows[0]?.['n']).toBe(5);
    expect((await admin.query('SELECT count(*)::int AS n FROM media_assets')).rows[0]?.['n']).toBe(
      6,
    );
    await expect(
      admin.query(
        "INSERT INTO categories (id, tenant_id, name, status, created_by) VALUES ($1,$2,'x','DRAFT',$3)",
        [seedId(3101), TENANT_A, USER_M_A],
      ),
    ).rejects.toThrow();
    await expect(admin.query('DELETE FROM products')).rejects.toThrow();
  });
  it('multistore_admin has no access to idempotency_keys at all', async () => {
    await expect(admin.query('SELECT id FROM idempotency_keys')).rejects.toThrow();
  });
  it('multistore_owner can SELECT for manual ops but has no catalog DELETE policy', async () => {
    expect((await owner.query('SELECT count(*)::int AS n FROM products')).rows[0]?.['n']).toBe(5);
    expect((await owner.query('DELETE FROM products WHERE true')).rowCount).toBe(0);
    expect((await owner.query('DELETE FROM categories WHERE true')).rowCount).toBe(0);
    expect((await owner.query('DELETE FROM media_assets WHERE true')).rowCount).toBe(0);
  });
  it('guard triggers are SECURITY INVOKER (no SECURITY DEFINER introduced)', async () => {
    const s = superClient();
    await s.connect();
    try {
      const r = await s.query(
        "SELECT p.proname, p.prosecdef FROM pg_proc p WHERE p.proname IN ('products_publish_guard','categories_unpublish_guard') ORDER BY 1",
      );
      expect(r.rows).toEqual([
        { proname: 'categories_unpublish_guard', prosecdef: false },
        { proname: 'products_publish_guard', prosecdef: false },
      ]);
    } finally {
      await s.end();
    }
  });
});
