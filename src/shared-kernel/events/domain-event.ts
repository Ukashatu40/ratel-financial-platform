// src/shared-kernel/events/domain-event.ts
export interface DomainEvent {
  readonly type: string;            // e.g. 'ExpenseApproved'
  readonly aggregateType: string;   // e.g. 'Expense'
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
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