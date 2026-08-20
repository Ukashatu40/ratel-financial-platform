// src/shared-kernel/outbox/outbox-event.mapper.ts
import { DomainEvent } from '../events/domain-event';

/**
 * Structurally typed rather than importing Prisma's generated `OutboxEvent`,
 * so this mapper stays dependency-free and a Prisma row satisfies it without
 * the shared kernel reaching for infrastructure types.
 */
export interface OutboxEventRow {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  createdAt: Date;
  payload: unknown;
  correlationId: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  source: string;
}

/**
 * Rebuilds the in-memory `DomainEvent` from its persisted outbox row.
 *
 * Extracted because TWO callers now need it — the outbox poller on first
 * delivery, and the redelivery worker on a retry. Reconstructing it separately
 * in each place is exactly the silent-drift risk TECH_DEBT #22/#37 closed for
 * the CSV field lists and the test-cleanup table list: a retry that rebuilt the
 * event even slightly differently would hand a subscriber a different event
 * than the one it originally failed on, and nothing would flag it.
 */
export function toDomainEvent(row: OutboxEventRow): DomainEvent {
  return {
    type: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    occurredAt: row.createdAt,
    payload: row.payload as Record<string, unknown>,
    correlationId: row.correlationId,
    requestId: row.requestId ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    source: row.source,
  };
}
