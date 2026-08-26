// src/shared-kernel/audit/audit.subscriber.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainEvent } from '../events/domain-event';
import { DomainEventDispatcher } from '../events/domain-event-dispatcher';
import { AuditLogService } from './audit-log.service';

// Common payload keys across every event type that identify "who did this" —
// a pragmatic heuristic rather than a formal contract, since DomainEvent
// payloads are untyped Record<string, unknown> by design (Phase 4/M0).
const ACTOR_KEYS = ['approverId', 'actorId', 'closedById', 'reopenedById', 'createdById'];

function extractActorId(payload: Record<string, unknown>): string | null {
  for (const key of ACTOR_KEYS) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * Before-image of whatever fields the action changed, for the `old_value` column
 * (TECH_DEBT #8).
 *
 * `AggregateRoot` computes the diff generically and puts it on the payload as
 * `changes: { field: { from, to } }`. This lifts the `from` side out, which is
 * exactly what `old_value` means. Returns undefined — stored as NULL — when the
 * event carries no `changes` at all: creation events, and events whose aggregate
 * mutated something other than its own props (`PayrollRun.addPayslip`). NULL is the
 * honest record there; `{}` would imply a diff was computed and found nothing.
 *
 * The `to` side is deliberately NOT stripped from `newValue`, which continues to
 * store the whole payload. Slightly redundant, but each column stays independently
 * meaningful and existing consumers of `newValue` keep working unchanged.
 */
function extractOldValue(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const changes = payload['changes'];
  if (changes === null || typeof changes !== 'object' || Array.isArray(changes)) return undefined;

  const oldValue: Record<string, unknown> = {};
  for (const [field, change] of Object.entries(changes as Record<string, unknown>)) {
    // Defensive about the shape rather than trusting it: this payload has been
    // through jsonb and back by the time a redelivery replays it.
    if (change !== null && typeof change === 'object' && 'from' in change) {
      oldValue[field] = (change as { from: unknown }).from;
    }
  }

  return Object.keys(oldValue).length > 0 ? oldValue : undefined;
}

/**
 * The Conformist subscriber from Phase 3.5 — registers globally (every
 * event type, no exceptions) via DomainEventDispatcher.registerGlobal().
 * Deliberately asks NOTHING of upstream contexts: it doesn't require them
 * to call it, tag events specially, or implement any interface. It just
 * listens to whatever's already flowing through the outbox dispatcher.
 *
 * KNOWN SIMPLIFICATION: this captures "an event fired, here's its payload"
 * as newValue — it does NOT do field-level before/after diffing (Phase 6's
 * "Old Value / New Value" columns, taken literally, implies diffing a
 * specific field's old vs. new value on direct edits). That's a
 * meaningfully bigger feature — it would require every mutating method on
 * every aggregate to capture and pass forward a diff, which none currently
 * do. What exists here is event-sourced-style audit (reconstructible
 * history via events), which satisfies "never lose history" and "who/what/
 * when" from the original requirements, but is NOT the same guarantee as
 * per-field diffs. Flagging this gap explicitly rather than silently
 * under-delivering on the original spec.
 */
@Injectable()
export class AuditSubscriber implements OnModuleInit {
  constructor(
    private readonly dispatcher: DomainEventDispatcher,
    private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    // The name is persisted as failed_event_deliveries.subscriber_name and is
    // the key used to redeliver a failed audit write to THIS subscriber alone.
    // Kept as a literal, not AuditSubscriber.name, so renaming the class can
    // never silently orphan stored retry rows.
    this.dispatcher.registerGlobal((event) => this.handle(event), 'AuditSubscriber');
  }

  private async handle(event: DomainEvent): Promise<void> {
    const organizationId = (event.payload['organizationId'] as string) ?? 'unknown';

    await this.auditLog.record({
      organizationId,
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      action: event.type,
      actorUserId: extractActorId(event.payload),
      oldValue: extractOldValue(event.payload),
      newValue: event.payload,
      reason: (event.payload['reason'] as string) ?? undefined,
      correlationId: event.correlationId ?? 'unknown',
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      source: event.source ?? 'background_worker',
    });
  }
}
