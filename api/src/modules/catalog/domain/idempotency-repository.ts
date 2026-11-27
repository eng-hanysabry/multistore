import { TxHandle } from '../../../common/tenancy/tenant-transaction-runner';

export interface IdempotencyRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly action: string;
  readonly key: string;
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * Idempotency persistence port (spec 10.7, M-2): records are scoped to
 * (tenant_id, user_id, action, key), write-once for the app role, 24 h retention.
 * insert returns false when the unique scope already holds a record: the caller then
 * reads the winner's row instead of executing the mutation a second time.
 */
export interface IdempotencyRepository {
  find(tx: TxHandle, action: string, key: string): Promise<IdempotencyRecord | null>;
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

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');
