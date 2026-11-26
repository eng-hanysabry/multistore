import { TenantContext } from './tenant-context';

/**
 * Opaque transaction handle. Domain and application code pass it to repository ports;
 * only the infrastructure implementation knows it is a Prisma transaction client.
 */
export type TxHandle = unknown;

/**
 * Spec 6.3 point 4: every request that touches tenant data runs through this runner, so
 * context and queries always share one connection and one transaction. The context is set
 * with the local flag inside the transaction and disappears at commit (transaction pooling
 * makes session-level settings unsafe).
 */
export interface TenantTransactionRunner {
  run<T>(ctx: TenantContext, work: (tx: TxHandle) => Promise<T>): Promise<T>;
}
