import { PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import {
  MEDIA_REPOSITORY,
  MediaRecord,
  MediaRepository,
  NewMediaRow,
} from '../domain/media-repository';
import { MediaKind, MediaStatus, VariantsJson } from '../domain/media-rules';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

interface Row {
  id: string;
  tenant_id: string;
  product_id: string | null;
  kind: MediaKind;
  status: MediaStatus;
  drive_file_key: string | null;
  original_filename: string | null;
  content_type: string;
  byte_size: number | null;
  width_px: number | null;
  height_px: number | null;
  variants: VariantsJson | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

const SELECT =
  'SELECT id::text, tenant_id::text, product_id::text, kind, status, drive_file_key, original_filename, content_type, byte_size, width_px, height_px, variants, uploaded_by::text, created_at::text, updated_at::text FROM media_assets';

const map = (r: Row): MediaRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  productId: r.product_id,
  kind: r.kind,
  status: r.status,
  driveFileKey: r.drive_file_key,
  originalFilename: r.original_filename,
  contentType: r.content_type,
  byteSize: r.byte_size,
  widthPx: r.width_px,
  heightPx: r.height_px,
  variants: r.variants,
  uploadedBy: r.uploaded_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Media metadata persistence through the caller's transaction (IP-5 Step 6). Every
 * statement runs under the request's RLS context, so the database itself rejects
 * cross-tenant rows, public reads of drafts and deletes on published products — the
 * repository never widens what the policies allow (6.3, 8.3).
 */
export class PrismaMediaRepository implements MediaRepository {
  async insert(tx: TxHandle, row: NewMediaRow): Promise<void> {
    await txOf(tx).$executeRaw`
      INSERT INTO media_assets (id, tenant_id, product_id, kind, status, drive_file_key,
                                original_filename, content_type, byte_size, width_px,
                                height_px, variants, uploaded_by)
      VALUES (${row.id}::uuid,
              NULLIF(current_setting('app.tenant_id', true), '')::uuid,
              ${row.productId}::uuid, ${row.kind}, ${row.status}, ${row.driveFileKey},
              ${row.originalFilename}, ${row.contentType}, ${row.byteSize}, ${row.widthPx},
              ${row.heightPx}, ${JSON.stringify(row.variants)}::jsonb,
              NULLIF(current_setting('app.user_id', true), '')::uuid)`;
  }

  async findById(tx: TxHandle, id: string): Promise<MediaRecord | null> {
    const found = await txOf(tx).$queryRawUnsafe<Row[]>(`${SELECT} WHERE id = $1::uuid`, id);
    return found[0] ? map(found[0]) : null;
  }

  async listByProduct(tx: TxHandle, productId: string): Promise<MediaRecord[]> {
    const rows = await txOf(tx).$queryRawUnsafe<Row[]>(
      `${SELECT} WHERE product_id = $1::uuid ORDER BY created_at, id`,
      productId,
    );
    return rows.map(map);
  }

  async replaceObjects(
    tx: TxHandle,
    id: string,
    next: {
      driveFileKey: string;
      contentType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
      variants: VariantsJson;
    },
  ): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`
      UPDATE media_assets
      SET drive_file_key = ${next.driveFileKey}, content_type = ${next.contentType},
          byte_size = ${next.byteSize}, width_px = ${next.widthPx},
          height_px = ${next.heightPx}, variants = ${JSON.stringify(next.variants)}::jsonb,
          updated_at = now()
      WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async setStatus(tx: TxHandle, id: string, status: MediaStatus): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`
      UPDATE media_assets SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async deleteById(tx: TxHandle, id: string): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`DELETE FROM media_assets WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async productStatus(tx: TxHandle, productId: string): Promise<'DRAFT' | 'PUBLISHED' | null> {
    const rows = await txOf(tx).$queryRaw<{ status: 'DRAFT' | 'PUBLISHED' }[]>`
      SELECT status FROM products WHERE id = ${productId}::uuid`;
    return rows[0]?.status ?? null;
  }
}

export { MEDIA_REPOSITORY };
