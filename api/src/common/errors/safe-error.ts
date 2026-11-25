import { randomUUID } from 'node:crypto';

export interface SafeErrorBody {
  code: string;
  message: string;
  requestId: string;
}

/** API error responses carry a safe message and the requestId only (spec 5.4, 6.8). */
export function toSafeError(code: string, safeMessage: string, requestId?: string): SafeErrorBody {
  return { code, message: safeMessage, requestId: requestId ?? randomUUID() };
}
