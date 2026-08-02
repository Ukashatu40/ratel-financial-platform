// src/shared-kernel/context/request-context.ts
import { AsyncLocalStorage } from 'async_hooks';

export type EventSource = 'api' | 'import_job' | 'integration' | 'background_worker';

export interface RequestContextData {
  correlationId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  source: EventSource;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Captures request-scoped metadata (correlation ID, IP, etc.) so it's
 * available anywhere downstream in the same async call chain — including
 * inside OutboxService.enqueue(), several layers below the controller —
 * WITHOUT threading it as an explicit parameter through every command/
 * handler signature. This is the mechanism Phase 4.4 referred to as
 * "same IDs land in audit_log_entries" without specifying how.
 */
export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  current(): RequestContextData | undefined {
    return storage.getStore();
  },
};
