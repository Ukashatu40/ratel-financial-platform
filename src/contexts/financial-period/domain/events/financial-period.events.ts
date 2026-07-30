// src/contexts/financial-period/domain/events/financial-period.events.ts
import { DomainEvent } from '../../../../shared-kernel/events/domain-event';

const AGGREGATE_TYPE = 'FinancialPeriod';

export function periodOpened(periodId: string, organizationId: string): DomainEvent {
  return {
    type: 'PeriodOpened',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: periodId,
    occurredAt: new Date(),
    payload: { organizationId },
  };
}

export function periodClosing(periodId: string, organizationId: string): DomainEvent {
  // Gives Expense/Payroll a chance to react BEFORE the hard close (Phase 3.1) —
  // e.g. auto-cancel stale drafts, notify approvers with pending items.
  return {
    type: 'PeriodClosing',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: periodId,
    occurredAt: new Date(),
    payload: { organizationId },
  };
}

export function periodClosed(periodId: string, organizationId: string, closedById: string): DomainEvent {
  return {
    type: 'PeriodClosed',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: periodId,
    occurredAt: new Date(),
    payload: { organizationId, closedById },
  };
}

export function periodReopened(periodId: string, organizationId: string, reopenedById: string): DomainEvent {
  return {
    type: 'PeriodReopened',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: periodId,
    occurredAt: new Date(),
    payload: { organizationId, reopenedById },
  };
}