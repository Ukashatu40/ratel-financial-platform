// src/contexts/expense/domain/events/expense.events.ts
import { DomainEvent } from '../../../../shared-kernel/events/domain-event';
import { ExpenseSource } from '../value-objects/expense-source';

const AGGREGATE_TYPE = 'Expense';

export function expenseDrafted(id: string, organizationId: string, source: ExpenseSource): DomainEvent {
  return {
    type: 'ExpenseDrafted',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, source },
  };
}

export function expenseSubmittedForApproval(id: string, organizationId: string): DomainEvent {
  return {
    type: 'ExpenseSubmittedForApproval',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId },
  };
}

export function expenseApproved(id: string, organizationId: string, approverId: string): DomainEvent {
  return {
    type: 'ExpenseApproved',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, approverId },
  };
}

export function expenseRejected(id: string, organizationId: string, approverId: string, reason: string): DomainEvent {
  return {
    type: 'ExpenseRejected',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, approverId, reason },
  };
}

export function expenseCancelled(id: string, organizationId: string, actorId: string): DomainEvent {
  return {
    type: 'ExpenseCancelled',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, actorId },
  };
}

export function expenseAdjustmentCreated(
  adjustmentId: string,
  organizationId: string,
  parentExpenseId: string,
  reason: string,
): DomainEvent {
  return {
    type: 'ExpenseAdjustmentCreated',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: adjustmentId,
    occurredAt: new Date(),
    payload: { organizationId, parentExpenseId, reason },
  };
}