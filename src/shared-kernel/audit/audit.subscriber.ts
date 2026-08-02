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
    this.dispatcher.registerGlobal((event) => this.handle(event));
  }

  private async handle(event: DomainEvent): Promise<void> {
    const organizationId = (event.payload['organizationId'] as string) ?? 'unknown';

    await this.auditLog.record({
      organizationId,
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      action: event.type,
      actorUserId: extractActorId(event.payload),
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
