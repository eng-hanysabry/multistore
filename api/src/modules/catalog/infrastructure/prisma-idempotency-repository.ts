import { PrismaClient } from '@prisma/client';
import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';
import { IdempotencyRecord, IdempotencyRepository } from '../domain/idempotency-repository';

const txOf = (tx: TxHandle): PrismaClient => tx as PrismaClient;

interface Row {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  key: string;
  request_hash: string;
  response_status: number;
  response_body: unknown;
  created_at: string;
  expires_at: string;
}

const map = (r: Row): IdempotencyRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  userId: r.user_id,
  action: r.action,
  key: r.key,
  requestHash: r.request_hash,
  responseStatus: r.response_status,
  responseBody: r.response_body,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

/**
 * Idempotency persistence (10.7, M-2). The tenant/user scope comes from the RLS context
 * on insert, never from the caller's payload; the unique index on
 * (tenant_id, user_id, action, key) is the final guard against double execution.
 */
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  async find(tx: TxHandle, action: string, key: string): Promise<IdempotencyRecord | null> {
    const rows = await txOf(tx).$queryRaw<Row[]>`
      SELECT id::text, tenant_id::text, user_id::text, action, key, request_hash,
             response_status, response_body, created_at::text, expires_at::text
      FROM idempotency_keys
      WHERE action = ${action} AND key = ${key} AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`;
    return rows[0] ? map(rows[0]) : null;
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
    // ON CONFLICT DO NOTHING: a concurrent duplicate yields 0 instead of aborting the
    // winner's transaction; the service then re-reads the stored record.
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
