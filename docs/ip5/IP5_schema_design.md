# IP-5 Schema Design: Catalog and Media

Status: DRAFT for review — Step 1 deliverable only
Authorization: Telegram messages 26970309, 26970315, 26970320, 26970325 (27 Nov 2026, 20:59 Cairo)
Corrections and decision resolutions: Telegram messages 27231065, 27231077, 27231079, 27231080, 27231082 (27 Nov 2026, 22:05 Cairo; "Batch 1"). PART A correction applied: the four id columns have NO database-level default; UUIDs are generated and supplied by the application/Prisma layer (approved IP-4/STM-20 rule). All former open questions M-1 through M-10 are resolved by that authorization; three resolutions differ from the originally proposed values and are marked below (NUMERIC(14,3); blocking category unpublish; STORE_LOGO never public).
Specification baseline: docs/spec/MultiStore_Final_Technical_Document_v4.9.md ("the spec")
Scope boundary: This document is the only repository change of IP-5 Step 1. It contains no executable SQL, no Prisma schema, no migration files, and no code. Nothing in this document closes any Security Gate or defers/resolves DI-1.

All statements below are classified as one of:

- **[SPEC]** — required by the v4.9 specification.
- **[DECISION]** — explicitly approved by the product owner in the Step-1 authorization (items J1–J13).
- **[PROPOSAL]** — a design choice proposed for the owner's review; not yet approved. (None remain: all Step-1 proposals were resolved by the Batch 1 authorization; see section M.)
- **[OPEN]** — unresolved; listed in section M and requires the owner's decision.

---

## A. Traceability Matrix

| # | Requirement | Source | Where addressed | Classification |
|---|---|---|---|---|
| A-01 | IP-5 covers catalog (categories, products) and media for the tenant storefront | Spec IP-5 definition (§22 roadmap, line ~1829) | Sections B, C | [SPEC] |
| A-02 | Category statuses DRAFT / PUBLISHED, default DRAFT | Authorization J2 | C-1, F | [DECISION] |
| A-03 | Product price_amount + price_currency, both nullable, no stock field, no currency default, no extra product fields | Authorization J1 | C-2 | [DECISION] |
| A-04 | Both-or-neither price rule (amount and currency set together or both NULL); NUMERIC(14,3) | Authorization J1 + Batch 1 | C-2, M-1 | [DECISION] |
| A-05 | Media model supports PRODUCT_IMAGE and STORE_LOGO kinds; branding endpoints deferred | Authorization J3 | C-3, G | [DECISION] |
| A-06 | Favorites and STM-03 deferred to IP-6; excluded from this schema | Authorization J4 | B (exclusions), L | [DECISION] |
| A-07 | Rate limiting on public catalog browsing + search endpoints via @nestjs/throttler (implementation-time); G-12 stays OPEN | Authorization J5, spec STM-24 | K | [DECISION] |
| A-08 | Product-name search, always scoped to URL tenant; limits, cursor pagination, parameterization, wildcard safety | Authorization J6, spec §8.6.12 | I-3, J | [DECISION] |
| A-09 | contact_details on tenants deferred to IP-6; not in IP-5 schema | Authorization J7 | B (exclusions) | [DECISION] |
| A-10 | No automated orphan-media cleanup job; document compensation, orphan tracking, manual reconciliation | Authorization J8, DI-1 | G-6, G-7 | [DECISION] |
| A-11 | Deletion only in DRAFT; published records must be unpublished first; referenced categories not deletable; no cascading deletion of Drive objects | Authorization J9 | F-3, G-5 | [DECISION] |
| A-12 | Image limits: 5 MB, 4000 px max dimension, 256 px thumb, 1024 px display, WebP | Authorization J10 | C-3, G-3 | [DECISION] |
| A-13 | sharp approved for Step 6 only (not Step 1) | Authorization J11 | K | [DECISION] |
| A-14 | googleapis Drive v3 via supported public API surface only | Authorization J12 | G-2, K | [DECISION] |
| A-15 | Drive OAuth deferred to Step 8; Steps 1–7 entirely local | Authorization J13 | G-2, L | [DECISION] |
| A-16 | Cross-tenant references prevented at database level (composite tenant-aware FKs) | Authorization §3.D | D | [SPEC]+[DECISION] |
| A-17 | RLS enabled + FORCE ROW LEVEL SECURITY on every new tenant-owned table; policy matrix by role/operation | Authorization §3.E; IP-4 approved patterns | E | [SPEC] |
| A-18 | Idempotency for mutating endpoints, 24 h retention | Spec §10.7 | H | [SPEC] |
| A-19 | Three-way cache separation (tenant resolver / catalog / image-CDN) | Authorization §3.J, spec §8.6.12 | J | [SPEC]+[DECISION] |
| A-20 | Tenant context transaction-local; TenantRunner; three-role DB model; no SECURITY DEFINER; no grant weakening | Authorization §4; IP-4 architecture | E, L | [SPEC] |
| A-21 | Migration strategy covers the IP-3 test-fixture `products` collision | Authorization §3.L | L-2 | [SPEC] |
| A-22 | Publication requires at least one image (publish gate) | Spec §8.7 (drafts/publish rules) | F-2 | [SPEC] |
| A-23 | Unpublish effective within the 60-second tenant-resolution cache window | Spec §8.7-C, §6.7 | J-4 | [SPEC] |

---

## B. Entity Relationship Design

### B.1 Entities

| Entity | Purpose | Tenant-owned |
|---|---|---|
| `categories` | Merchant-managed grouping of products within one store | Yes |
| `products` | Merchant-managed sellable items within one store | Yes |
| `media_assets` | Uploaded images: product images and store logos, with derived variants | Yes |
| `idempotency_keys` | Server-side idempotency records for mutating catalog/media endpoints (spec §10.7) | Yes (tenant + user scoped) |

Existing IP-4 entities referenced but not modified: `tenants`, `users`, `memberships`.

### B.2 Explicit exclusions (per authorization)

- **Favorites / STM-03** — deferred to IP-6 (J4). No favorites table in this design.
- **`tenants.contact_details`** — deferred to IP-6 (J7). No column added.
- **Branding endpoints** — deferred (J3). The `STORE_LOGO` kind exists in the model only so the schema does not need rework when branding ships.

### B.3 ER diagram (Mermaid)

```mermaid
erDiagram
    TENANTS ||--o{ CATEGORIES : owns
    TENANTS ||--o{ PRODUCTS : owns
    TENANTS ||--o{ MEDIA_ASSETS : owns
    TENANTS ||--o{ IDEMPOTENCY_KEYS : scopes
    USERS ||--o{ CATEGORIES : creates
    USERS ||--o{ PRODUCTS : creates
    USERS ||--o{ MEDIA_ASSETS : uploads
    USERS ||--o{ IDEMPOTENCY_KEYS : scopes
    CATEGORIES ||--o{ PRODUCTS : groups
    PRODUCTS ||--o{ MEDIA_ASSETS : illustrates

    CATEGORIES {
        uuid id PK
        uuid tenant_id FK
        text name
        text status
        timestamptz published_at
        uuid created_by FK
    }
    PRODUCTS {
        uuid id PK
        uuid tenant_id FK
        uuid category_id FK_nullable
        text name
        text description
        numeric price_amount_nullable
        char3 price_currency_nullable
        text status
        timestamptz published_at
        uuid created_by FK
    }
    MEDIA_ASSETS {
        uuid id PK
        uuid tenant_id FK
        uuid product_id FK_nullable
        text kind
        text status
        text drive_file_key
        jsonb variants
    }
    IDEMPOTENCY_KEYS {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        text action
        text key
        timestamptz expires_at
    }
```

### B.4 Relationship and ownership notes

1. Every new table carries `tenant_id` and is owned by exactly one tenant. Tenant ownership is enforced by composite foreign keys (section D), not by application checks alone.
2. `users` is a **platform-global** table (IP-4 migration: `users` has no `tenant_id`; tenant binding happens through `memberships`). Therefore `created_by` / `uploaded_by` are plain FKs to `users(id)`; the tenant boundary is carried by the row's own `tenant_id` plus the composite FKs, and by RLS.
3. `categories → products` is one-to-many, nullable on the product side (a product may be uncategorized — see F-4/M-4).
4. `products → media_assets` is one-to-many. `STORE_LOGO` assets attach to the tenant, not a product (`product_id` NULL, kind = STORE_LOGO).
5. `idempotency_keys` references both `tenants` and `users`; see section H for the uniqueness-scope review the authorization requires.

---

## C. Field-Level Schema Proposal

Types are conceptual proposed Postgres types, not executable DDL.

### C.1 `categories`

| Field | Type | Null | Default | Key | Constraints | Index | Purpose | Ref |
|---|---|---|---|---|---|---|---|---|
| id | uuid | NO | none — application/Prisma supplies the UUID (STM-20) | PK | — | PK | Row identity | IP-4 pattern |
| tenant_id | uuid | NO | — | FK→tenants(id); part of UNIQUE(tenant_id,id) | — | composite (D) | Tenant ownership | §3.D authz |
| name | text | NO | — | — | length 1..120 [DECISION M-9] | — | Display name | spec §8.6 |
| status | text | NO | 'DRAFT' | — | IN ('DRAFT','PUBLISHED') | (tenant_id,status,…) I-1 | Lifecycle state | J2 [DECISION] |
| published_at | timestamptz | YES | NULL | — | NULL while DRAFT, set while PUBLISHED [DECISION, Batch 1] | — | Publication timestamp | spec §8.7 |
| created_by | uuid | NO | — | FK→users(id) | — | — | Creator reference | authz §3.C |
| created_at | timestamptz | NO | now() | — | — | — | Audit | IP-4 pattern |
| updated_at | timestamptz | NO | now() | — | — | — | Audit | IP-4 pattern |

### C.2 `products`

| Field | Type | Null | Default | Key | Constraints | Index | Purpose | Ref |
|---|---|---|---|---|---|---|---|---|
| id | uuid | NO | none — application/Prisma supplies the UUID (STM-20) | PK | — | PK | Row identity | IP-4 pattern |
| tenant_id | uuid | NO | — | FK part of composite | — | composite (D) | Tenant ownership | §3.D authz |
| category_id | uuid | YES | NULL | part of composite FK (tenant_id, category_id)→categories(tenant_id,id) | composite FK (D) | (tenant_id,category_id) I-1 | Grouping | D |
| name | text | NO | — | — | length 1..200 [DECISION M-9] | search I-3 | Display name; search target | J6 |
| description | text | YES | NULL | — | length ≤ 5000 [DECISION M-9] | — | Detail text | spec §8.6 |
| price_amount | numeric(14,3) | YES | NULL | — | ≥ 0 when set [DECISION] | — | Price value | J1 + Batch 1 [DECISION] |
| price_currency | char(3) | YES | NULL | — | `~ '^[A-Z]{3}$'` (ISO 4217 validation) [DECISION] | — | Price currency | J1 + Batch 1 [DECISION] |
| status | text | NO | 'DRAFT' | — | IN ('DRAFT','PUBLISHED') | (tenant_id,status,…) I-1 | Lifecycle state | spec §8.7 |
| published_at | timestamptz | YES | NULL | — | NULL while DRAFT, set while PUBLISHED [DECISION, Batch 1] | — | Publication timestamp | spec §8.7 |
| created_by | uuid | NO | — | FK→users(id) | — | — | Creator reference | authz §3.C |
| created_at | timestamptz | NO | now() | — | — | — | Audit | IP-4 pattern |
| updated_at | timestamptz | NO | now() | — | — | — | Audit | IP-4 pattern |

Price pairing rule [DECISION M-1, approved in Batch 1]: `CHECK ((price_amount IS NULL) = (price_currency IS NULL))` — both fields NULL together or populated together. Precision resolved to NUMERIC(14,3) by the Batch 1 authorization. No currency default (explicitly no EGP default, J1). No stock/quantity field (J1). No other extra product fields (J1).

### C.3 `media_assets`

| Field | Type | Null | Default | Key | Constraints | Index | Purpose | Ref |
|---|---|---|---|---|---|---|---|---|
| id | uuid | NO | none — application/Prisma supplies the UUID (STM-20) | PK | — | PK | Row identity | IP-4 pattern |
| tenant_id | uuid | NO | — | FK part of composite | — | composite (D) | Tenant ownership | §3.D authz |
| product_id | uuid | YES | NULL | part of composite FK (tenant_id, product_id)→products(tenant_id,id) | required when kind=PRODUCT_IMAGE; must be NULL when kind=STORE_LOGO [DECISION, Batch 1] | (tenant_id,product_id) I-1 | Owning product | D, J3 |
| kind | text | NO | — | — | IN ('PRODUCT_IMAGE','STORE_LOGO') | — | Media kind | J3 [DECISION] |
| status | text | NO | 'ACTIVE' | — | IN ('UPLOADING','ACTIVE','FAILED','ORPHANED') [DECISION M-6] | (tenant_id,status) | Upload/orphan lifecycle | J8 + Batch 1 |
| drive_file_key | text | YES | NULL | — | unique [DECISION, Batch 1] | — | Drive object id; server-only, never serialized to clients | J12, G-2 |
| original_filename | text | YES | NULL | — | — | — | Diagnostics only | G-3 |
| content_type | text | NO | — | — | 'image/webp' after processing | — | Stored format | J10 |
| byte_size | integer | YES | NULL | — | ≤ 5 MB at upload intake | — | Intake limit evidence | J10 [DECISION] |
| width_px / height_px | integer | YES | NULL | — | each ≤ 4000 after processing | — | Dimensions | J10 [DECISION] |
| variants | jsonb | YES | NULL | — | shape: `{thumb: {key,width:256}, display: {key,width:1024}}` [DECISION, Batch 1] | — | Derived variant metadata (WebP 256/1024) | J10 [DECISION] |
| uploaded_by | uuid | NO | — | FK→users(id) | — | — | Uploader reference | authz §3.C |
| created_at / updated_at | timestamptz | NO | now() | — | — | — | Audit | IP-4 pattern |

### C.4 `idempotency_keys`

| Field | Type | Null | Default | Key | Constraints | Index | Purpose | Ref |
|---|---|---|---|---|---|---|---|---|
| id | uuid | NO | none — application/Prisma supplies the UUID (STM-20) | PK | — | PK | Row identity | IP-4 pattern |
| tenant_id | uuid | NO | — | FK→tenants(id) | — | part of UNIQUE | Tenant scope | §10.7 |
| user_id | uuid | NO | — | FK→users(id) | — | part of UNIQUE | Actor scope [DECISION M-2] | §10.7 |
| action | text | NO | — | — | e.g. 'product.create' | part of UNIQUE | Endpoint identity | §10.7 |
| key | text | NO | — | — | length 1..128 [DECISION M-9] | part of UNIQUE | Client idempotency key | §10.7 |
| request_hash | text | NO | — | — | — | — | Detect same-key/different-payload reuse | §10.7 |
| response_status | integer | NO | — | — | — | — | Stored result | §10.7 |
| response_body | jsonb | NO | — | — | — | — | Stored result | §10.7 |
| created_at | timestamptz | NO | now() | — | — | — | Retention base | §10.7 |
| expires_at | timestamptz | NO | now()+24h | — | — | (expires_at) for prune | 24 h retention | §10.7 [SPEC] |

Uniqueness [DECISION M-2, approved in Batch 1]: `UNIQUE (tenant_id, user_id, action, key)`. The spec requires storing key + result for 24 h but does not define the uniqueness scope. Including `user_id` prevents one user's replay from receiving another user's stored response (cross-user information leak) and prevents accidental cross-user key collisions. This refinement is proposed for approval.

---

## D. Tenant Isolation and Foreign Keys (critical)

Goal [SPEC per authorization §3.D]: a product must not be able to reference a category owned by another tenant, even if the application layer makes a mistake. Application checks are necessary but not sufficient.

Mechanism [DECISION, approved in Batch 1]:

1. **Composite uniqueness on the referenced table.**
   - `categories`: `UNIQUE (tenant_id, id)` in addition to PK(id).
   - `products`: `UNIQUE (tenant_id, id)` in addition to PK(id).
2. **Composite foreign keys on the referencing table.**
   - `products (tenant_id, category_id)` → `categories (tenant_id, id)` ON DELETE RESTRICT. A row whose `category_id` belongs to another tenant violates the FK because the `(tenant_id, category_id)` pair does not exist.
   - `media_assets (tenant_id, product_id)` → `products (tenant_id, id)` ON DELETE RESTRICT. Same guarantee for media→product.
3. **Direct FKs to global tables stay simple:** `tenant_id → tenants(id)`, `created_by/uploaded_by/user_id → users(id)`. `users` is global (IP-4), so no composite needed there; the tenant boundary is already carried by the row's own `tenant_id` which the composite FKs bind to every other tenant-owned row it references.
4. **Nullability:** `category_id` NULL means uncategorized; composite FKs permit NULL members under default MATCH SIMPLE semantics, so uncategorized products remain valid.
5. **Deletion behavior:** ON DELETE RESTRICT on both composite FKs implements J9's "categories referenced by products cannot be deleted until their relationships are resolved" at the database level. There is **no** cascade anywhere; Drive objects are never touched by database deletion (J9).

This is documented conceptually; no SQL is written in this step.

---

## E. RLS and Database Security Design

### E.1 Baseline (follows approved IP-4 patterns)

- Every new tenant-owned table: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- UUID primary and foreign keys throughout (IP-4 pattern).
- Three-role database model preserved: `multistore_owner` (migrations + approved operational policies), `multistore_app` (application traffic), `multistore_admin` (read-only operational inspection). No new roles. No grant weakening. No SECURITY DEFINER functions.
- Tenant context is transaction-local via the established TenantRunner and approved context keys (`app.tenant_id`, `app.role` — the IP-4 keys); policies read those keys exactly as IP-4 policies do.
- No policy or SQL is created or executed in this step.

### E.2 Policy matrix by role and operation

Roles: GUEST (no auth), CUSTOMER (authenticated non-merchant), MERCHANT (active membership in the tenant), multistore_admin (DB role), multistore_owner (DB role). "own" = row's tenant_id = current_setting('app.tenant_id').

**categories**

| Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| GUEST | published rows of an ACTIVE tenant only | — | — | — |
| CUSTOMER | published rows of an ACTIVE tenant only | — | — | — |
| MERCHANT | all rows of own tenant | own tenant, app.role check | own tenant | own tenant, DRAFT + unreferenced only (also enforced by FK RESTRICT + lifecycle, F-3) |
| multistore_admin | SELECT (operational inspection, IP-4 pattern) | — | — | — |
| multistore_owner | approved operational policies only (IP-4 pattern: 7-day cleanup precedent, manual ops) | — | — | — |

**products** — same shape as categories: GUEST/CUSTOMER see PUBLISHED products of an ACTIVE tenant only (plus the category-visibility rule in F-4); MERCHANT full CRUD within own tenant with DELETE restricted to DRAFT; admin SELECT; owner operational only.

**media_assets**

| Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| GUEST | PRODUCT_IMAGE rows whose product is PUBLISHED and visible (EXISTS subquery on products). STORE_LOGO: no public access at this stage [DECISION M-7, Batch 1] | — | — | — |
| CUSTOMER | same as GUEST (no STORE_LOGO access) [DECISION M-7, Batch 1] | — | — | — |
| MERCHANT | all rows of own tenant | own tenant | own tenant | own tenant, DRAFT-product media or logo; external-object cleanup handled separately (G-5) |
| multistore_admin | SELECT | — | — | — |
| multistore_owner | manual reconciliation only (G-7) | — | — | — |

**idempotency_keys**

| Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| GUEST | — | — | — | — |
| CUSTOMER / MERCHANT | own (tenant_id + user_id) rows | own rows (written inside the request transaction) | — (immutable) | — |
| multistore_admin | — | — | — | — |
| multistore_owner | — | — | — | 24 h prune (`expires_at < now()`) via an explicit owner policy, following the approved IP-4 7-day-cleanup precedent |

### E.3 Publication-state effects on public access

- GUEST/CUSTOMER visibility requires `status = 'PUBLISHED'` on the row **and** publication timestamps set (`published_at IS NOT NULL`).
- DRAFT rows are invisible to GUEST/CUSTOMER at the RLS layer, not merely filtered in queries.
- Tenant suspension: the IP-4 tenants policies already hide non-ACTIVE tenants from the app role, and the TenantResolver rejects suspended tenants at the application layer. Whether catalog read policies additionally embed an `EXISTS (SELECT 1 FROM tenants … status='ACTIVE')` defense-in-depth check or rely on the resolver + tenants policies is resolved [DECISION M-5, Batch 1]: rely on the existing layers (TenantResolver rejects suspended tenants; IP-4 tenants policies hide non-ACTIVE tenants from the app role), with no extra join inside catalog policies.

---

## F. Product and Category Lifecycle

### F.1 States

Both categories and products: `DRAFT → PUBLISHED → DRAFT` (unpublish returns to DRAFT and clears `published_at` [DECISION, Batch 1]).

### F.2 Publish gates

- Category publish: no content gate (name only).
- Product publish [SPEC §8.7]: requires **at least one ACTIVE PRODUCT_IMAGE** (A-22). [DECISION M-3, Batch 1]: if `category_id` is set, the category must be PUBLISHED before the product can be published. Enforced at the database level (SECURITY INVOKER trigger, following the approved IP-4 users_protect_sensitive precedent) in addition to the application check.

### F.3 Deletion rules [DECISION J9]

- Deletion permitted only while the record is DRAFT. Published products/categories must be unpublished first.
- Categories referenced by products cannot be deleted until the relationships are resolved — enforced by the composite FK ON DELETE RESTRICT (D-5) independent of application code.
- No cascading database deletion of external Drive objects (J9). Database deletion and external-media cleanup are separate responsibilities, documented in G-5.

### F.4 Category unpublish restriction and public visibility [DECISION M-4, Batch 1]

The Batch 1 authorization resolved M-4 with the BLOCKING variant (opposite of the original proposal): **a category cannot be unpublished while it still has published products.** The merchant must unpublish or reassign those products first. Enforced at the database level by a SECURITY INVOKER trigger on category status transitions, in addition to the application check.

Public visibility rule (now guaranteed by construction, still checked defensively in policies): a product is publicly visible iff `products.status='PUBLISHED'` AND (`category_id IS NULL` OR its category is PUBLISHED) AND the tenant is ACTIVE.

---

## G. Media Model and Storage

### G.1 Ownership and kinds [DECISION J3]

`media_assets` is tenant-owned, with `kind` distinguishing PRODUCT_IMAGE (attached to a product) from STORE_LOGO (attached to the tenant). The model supports both kinds now; branding endpoints remain deferred and are not designed here.

### G.2 Storage architecture

- Storage goes through the existing **StorageProvider port** pattern (IP-4 ports under `api/src/common/ports`), keeping external storage operations separate from database transaction assumptions (authorization §3.G).
- Drive integration uses the existing `googleapis` package's **supported public Drive v3 API surface only** — no internal package paths [DECISION J12].
- Drive OAuth is deferred to Step 8; Steps 1–7 are entirely local [DECISION J13]. The schema therefore stores provider-neutral metadata and a nullable `drive_file_key` so local-only steps function without Drive.
- `drive_file_key` and storage keys are **server-only**: never exposed in API responses.

### G.3 Keys, variants, limits [DECISION J10]

- Object keys are UUID-based: `media/{tenant_id}/{asset_uuid}/{variant}.webp`; variant ∈ {original, thumb, display}. Original filenames are metadata only.
- Limits: intake ≤ 5 MB; processed dimensions ≤ 4000 px; derived variants thumb 256 px and display 1024 px, WebP. Actual transcode happens in Step 6 with sharp (J11); the schema stores the resulting metadata (`variants` jsonb, dimensions, byte_size, content_type).

### G.4 Replacement semantics

Replacement creates **new keys** (new asset or new variants) and deletes old external objects **after** the database commit — never inside the transaction and never before the new state is durable. This keeps a failed external delete from rolling back a successful database change.

### G.5 Database vs external cleanup responsibilities [DECISION J9/J8]

- **Database responsibility:** row state transitions only (status → ORPHANED/FAILED; row deletion in DRAFT lifecycle). Database deletion never cascades to Drive.
- **External responsibility:** deleting Drive objects, performed as a separate, explicitly logged operation after commit.
- **Failed upload compensation:** if processing or external storage fails after an object was created, the created external objects are deleted best-effort and the row is marked FAILED (or never inserted if failure precedes insert).
- **Failed external deletion:** the object identity is retained on the row so reconciliation can find it (G-7).

### G.6 Orphan tracking [DECISION J8]

No automated cleanup job and no background retry under DI-1. Orphans are tracked via the row `status` field (ORPHANED) and identifiable by reconciliation queries (e.g., FAILED/UPLOADING rows older than a threshold, ACTIVE rows whose drive_file_key no longer resolves, Drive objects with no row).

### G.7 Manual reconciliation procedure [DECISION J8]

Documented runbook (to be finalized at implementation): (1) snapshot `media_assets` keys/ids as multistore_owner (read-only); (2) list Drive objects under the tenant prefix; (3) diff both directions; (4) for DB-only rows, mark ORPHANED; for Drive-only objects, delete via the storage port after human confirmation; (5) record the reconciliation in the audit log. Manual, on-demand, no scheduler.

### G.8 Access control

Public (published) media is readable by GUEST/CUSTOMER per E-2; draft media is merchant-only. Media bytes are served with per-request authorization checks at the application layer; the server never proxies Drive credentials to clients.

---

## H. Idempotency Design

- Applies to all mutating catalog/media endpoints [SPEC §10.7]: create/update/publish/unpublish/delete for categories and products, and media upload/delete.
- Server stores key + request hash + response for 24 h (C.4). Replay with the same key and same request hash returns the stored response without re-executing; same key with a **different** payload is rejected (conflict), which is why `request_hash` is stored.
- Records are immutable for the app role (INSERT + SELECT only); expiry is enforced by an owner-role prune policy (E-2), reusing the approved IP-4 owner-policy precedent.
- Uniqueness scope `(tenant_id, user_id, action, key)` is [DECISION M-2, Batch 1] — see C.4 for the leak/collision rationale.
- Records are written inside the request transaction so a rolled-back mutation leaves no idempotency record. (IP-4 learning: with STM-19's connection_limit=1, external side effects are queued after commit; idempotency rows are pure DB writes in-transaction and safe.)

---

## I. Indexes and Performance

### I.1 Indexes [DECISION, approved in Batch 1]

| Table | Index | Serves |
|---|---|---|
| categories | UNIQUE (tenant_id, id) | Composite FK target (D) |
| categories | (tenant_id, status, created_at, id) | Public listing + cursor pagination |
| products | UNIQUE (tenant_id, id) | Composite FK target (D) |
| products | (tenant_id, status, created_at, id) | Public listing + cursor pagination |
| products | (tenant_id, category_id) | Category-filtered listing; FK lookups |
| media_assets | UNIQUE (tenant_id, id) [DECISION M-10, symmetry with the D pattern] | Consistency with D pattern |
| media_assets | (tenant_id, product_id) | Product media lookup; FK lookups |
| media_assets | (tenant_id, status) | Orphan/failed reconciliation (G-6) |
| media_assets | UNIQUE (drive_file_key) WHERE drive_file_key IS NOT NULL | Storage-object identity |
| idempotency_keys | UNIQUE (tenant_id, user_id, action, key) | Replay detection |
| idempotency_keys | (expires_at) | 24 h prune |

### I.2 Cursor pagination [DECISION J6]

Keyset pagination on `(created_at, id)` (stable, tie-broken), opaque cursor token encoding both values; no OFFSET for public endpoints.

### I.3 Search [DECISION J6]

Product-name search always scoped to the URL tenant (`tenant_id` from the resolver, never from client input). Documented limits:

- Maximum query length: 100 characters [DECISION M-9, Batch 1].
- Maximum page size: 50 [DECISION M-9, Batch 1].
- Parameterized queries only (Prisma parameterized filters; no string-built SQL).
- Wildcard/special-character safety: user input is escaped for LIKE metacharacters (`%`, `_`, `\`) before use in a `LIKE/ILIKE` pattern [DECISION M-9, Batch 1].
- No fuzzy search, no `pg_trgm`, no other extensions without separate approval (J6). Plain ILIKE on `name` with a seq scan is acceptable at pilot scale; the (tenant_id, status, …) indexes bound the scanned set to one tenant.

---

## J. Cache and Invalidation Design

### J.1 Three separate caches [SPEC §8.6.12 + authorization]

1. **Tenant resolver cache** (existing, 60 s): resolves tenantCode → tenant. It does **not** provide catalog or media invalidation.
2. **Catalog response cache**: HTTP-level caching of public catalog GET responses.
3. **Image/CDN cache**: HTTP-level caching of served image bytes/variants.

### J.2 Cache behavior [DECISION M-8, Batch 1; implementation deferred to Step 7]

| Content | Cache-Control | Rationale |
|---|---|---|
| Draft/private catalog and media (merchant views) | `no-store` | Never cache unauthorized content |
| Published catalog list/detail GET | `no-cache` + ETag | Revalidate each request (cheap 304s) so publish/unpublish is visible immediately at the catalog layer |
| Published image variants | `public, max-age=60` | Key-addressed URLs; bounded staleness to meet the 60 s deadline (J-4) |
| Draft image variants | `private, no-store` | Merchant-only |

Cache keys for any shared cache must include tenant and authorization context; no cross-tenant cache entries. No server-side response cache is introduced in IP-5 beyond HTTP headers [DECISION M-8, Batch 1].

### J.3 Invalidation events

- **Publish/unpublish:** changes visibility at the URL/authorization layer. Because published catalog responses use `no-cache`+ETag and image URLs are key-addressed, unpublish takes effect without purging: the product/detail URL stops resolving publicly, and image-serving re-checks publication state per request.
- **Replacement:** new keys → new URLs; old keys are deleted after commit (G-4), so stale content ages out with the 60 s max-age at worst.
- **Permission changes** (membership revoke, tenant suspend): handled by the existing 60 s tenant-resolver window plus `no-store` on private content.

### J.4 Invalidation deadline [SPEC §8.7-C]

The spec requires unpublish to be effective "within the 60-second tenant-resolution cache window". Under J.2, worst-case staleness is: tenant-resolver 60 s for tenant-state changes, 0 s (revalidation) for catalog state, ≤60 s for already-cached image bytes. The image variant max-age of 60 s is chosen to stay within that budget [DECISION M-8, Batch 1].

---

## K. Security and Dependency Impact

Approved future dependency decisions [DECISION J5/J11/J12] — recorded here; **nothing is installed or modified in Step 1**:

1. **@nestjs/throttler** — approved for IP-5 public catalog browsing + search endpoints only (STM-24). G-12 remains OPEN until implementation evidence is reviewed and signed off. The implementation must document: trusted client-IP extraction behind the actual proxy topology (Vercel edge → API; only the configured trusted proxy hop's X-Forwarded-For is honored), threshold tests, consistent 429 responses with Retry-After, and must not treat per-instance in-memory counters as proof of global rate limiting in a multi-instance deployment. No Redis or other external service without separate approval. The approved scope must not silently extend to unrelated endpoints.
2. **sharp** — approved for Step 6 only (J11), with the Vercel-equivalent smoke test required at that step.
3. **googleapis (existing)** — Drive API v3 via the supported public API surface only; no internal package paths (J12). Relevance to this schema: `drive_file_key` and variant metadata are provider-shaped but provider-neutral; OAuth wiring is Step 8 (J13).

Schema-level security notes: no SECURITY DEFINER functions; no grant weakening; all new tables follow the approved tenant-isolation model (authorization §4).

---

## L. Migration Strategy and Rollback Design (conceptual)

### L.1 Proposed migration order

Single migration, table order: `categories` → `products` → `media_assets` → `idempotency_keys` (dependency order; idempotency_keys is independent of the other three but grouped for one review unit). RLS + FORCE + policies + grants in the same migration, following the IP-4 migration-lint pattern.

### L.2 Fixture collision [SPEC per authorization §3.L]

`api/test/rls/fixtures/001_products.sql` (IP-3-era RLS test fixture) creates minimal `products`/`favorites` tables that collide with the real catalog tables. At implementation time the RLS test harness must switch from that fixture to the real migration, and the affected specs must be updated to the real schema (favorites tests are removed or parked until IP-6, per J4). This is flagged here so the future step plans for it explicitly.

### L.3 Verification, ownership, locality

- Migration lint, RLS, and grant verification follow the IP-4 patterns (conditional references to Supabase-only roles; superuser-only catalog assertions in tests; empty privilege snapshot treated as failure, never as proof).
- Migrations are applied by `multistore_owner`, never postgres/service_role (IP-4 rule).
- Local-first: the migration is rehearsed against the local PG instance before any non-local target; per the standing boundary there is no real Supabase migration without separate authorization.
- Steps 1–7 remain entirely local (J13).

### L.4 Rollback

Rollback = drop the four new tables (and their policies/indexes) in reverse order. No production data exists; before any future real application, a pre-migration export per D2 is taken. Rollback does not touch `tenants`, `users`, `memberships`, or any IP-4 table.

---

## M. Design Decisions (all resolved by the Batch 1 authorization, 27 Nov 2026, 27231065)

All ten questions were resolved by the owner's Batch 1 authorization ("Preserve all approved decisions M-1 through M-10"). Three resolutions differ from the values originally proposed in Step 1 and are marked *changed*:

| # | Decision | Final value |
|---|---|---|
| M-1 | Price rules | Paired NULL check `(price_amount IS NULL) = (price_currency IS NULL)`; `price_amount ≥ 0`; currency regex `^[A-Z]{3}$`; precision **NUMERIC(14,3)** — *changed* from the proposed numeric(12,2) |
| M-2 | Idempotency uniqueness includes `user_id` | UNIQUE(tenant_id, user_id, action, key) — as proposed |
| M-3 | Product publish requires its category (if set) to be PUBLISHED | Adopted; enforced at database level via SECURITY INVOKER trigger |
| M-4 | Category unpublish with published products | **BLOCKED** — *changed* from the proposed non-blocking visibility rule: a category cannot be unpublished while published products reference it; DB-level trigger enforcement |
| M-5 | Tenant-active check inside catalog policies | Rely on resolver + tenants policies (no extra join) — as proposed |
| M-6 | media_assets status enum | UPLOADING/ACTIVE/FAILED/ORPHANED — as proposed |
| M-7 | STORE_LOGO visibility | **No public access at this stage** — *changed* from the proposed public-read |
| M-8 | Cache headers | Published catalog `no-cache`+ETag; published images `public, max-age=60`; draft `no-store`/`private, no-store`; no server-side cache (implementation in Step 7) — as proposed |
| M-9 | Field/page limits | Category name 120, product name 200, description 5000, search query 100, page size 50 — as proposed |
| M-10 | media_assets UNIQUE(tenant_id,id) | Adopted — as proposed |

No ambiguity was resolved silently; the authorization text is archived verbatim in the approval record.

---

*End of IP-5 Step 1 deliverable. Steps stop here per the authorization's stop condition: no Step 2, no SQL, no migrations, no Prisma changes, no dependency installs, no implementation until explicitly authorized.*
