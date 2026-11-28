import { PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import {
  MediaIdempotencyRepository,
  StoredIdempotencyRecord,
} from '../domain/media-idempotency-repository';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

interface Row {
  request_hash: string;
  response_status: number;
  response_body: unknown;
}

/**
 * Media idempotency persistence (10.7, G.7): the same idempotency_keys table and
 * contract as catalog, scoped by the RLS context on insert — tenant and user never come
 * from the payload, and the unique (tenant_id, user_id, action, key) index is the final
 * guard against double execution.
 */
export class PrismaMediaIdempotencyRepository implements MediaIdempotencyRepository {
  async find(tx: TxHandle, action: string, key: string): Promise<StoredIdempotencyRecord | null> {
    const rows = await txOf(tx).$queryRaw<Row[]>`
      SELECT request_hash, response_status, response_body
      FROM idempotency_keys
      WHERE action = ${action} AND key = ${key} AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`;
    const r = rows[0];
    return r
      ? {
          requestHash: r.request_hash,
          responseStatus: r.response_status,
          responseBody: r.response_body,
        }
      : null;
  }

  async insert(
    tx: TxHandle,
    row: {
      id: string;
      action: string;
      key: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
    },
  ): Promise<boolean> {
    const n = await txOf(tx).$executeRaw`
      INSERT INTO idempotency_keys (id, tenant_id, user_id, action, key, request_hash,
                                    response_status, response_body)
      VALUES (${row.id}::uuid,
              NULLIF(current_setting('app.tenant_id', true), '')::uuid,
              NULLIF(current_setting('app.user_id', true), '')::uuid,
              ${row.action}, ${row.key}, ${row.requestHash}, ${row.responseStatus},
              ${JSON.stringify(row.responseBody)}::jsonb)
      ON CONFLICT (tenant_id, user_id, action, key) DO NOTHING`;
    return n > 0;
  }
}
