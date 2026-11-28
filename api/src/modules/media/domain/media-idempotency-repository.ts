import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';

export interface StoredIdempotencyRecord {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

/**
 * Media idempotency port (spec 10.7, schema design G.7: media upload and delete accept
 * Idempotency-Key). Same table and contract as the catalog side, re-declared here
 * because module boundaries (5.3) do not allow cross-module imports: the media module
 * owns its port and its own Prisma implementation against idempotency_keys.
 */
export interface MediaIdempotencyRepository {
  find(tx: TxHandle, action: string, key: string): Promise<StoredIdempotencyRecord | null>;
  /** False when the (tenant, user, action, key) row already exists (unique race lost). */
  insert(
    tx: TxHandle,
    row: {
      id: string;
      action: string;
      key: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
    },
  ): Promise<boolean>;
}

export const MEDIA_IDEMPOTENCY_REPOSITORY = Symbol('MEDIA_IDEMPOTENCY_REPOSITORY');
