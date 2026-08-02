// src/shared-kernel/events/domain-event.ts
export interface DomainEvent {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;

  // Populated ONLY by OutboxDispatchService when reconstructing an event
  // from its persisted outbox row — domain/aggregate code (AggregateRoot,
  // Expense, PayrollRun, etc.) never sets these. Optional specifically so
  // domain code creating events (via expenseApproved(), etc.) doesn't need
  // to know these fields exist at all.
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly source?: string;
}
/**
 * Base class every aggregate root extends to get event-recording for free.
 * Handlers call pullDomainEvents() after invoking a mutating method — this
 * is what makes events derive FROM the state change rather than being
 * constructed separately and risking drift (Phase 5.2).
 */
export abstract class AggregateRoot {
  private domainEvents: DomainEvent[] = [];

  protected recordEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = this.domainEvents;
    this.domainEvents = [];
    return events;
  }
}
