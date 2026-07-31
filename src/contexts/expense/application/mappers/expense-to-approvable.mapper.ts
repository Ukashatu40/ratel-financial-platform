// src/contexts/expense/application/mappers/expense-to-approvable.mapper.ts
import { Approvable } from '../../../../shared-kernel/workflow/approvable';
import { Expense } from '../../domain/aggregates/expense.aggregate';

export function expenseToApprovable(expense: Expense): Approvable {
  return {
    id: expense.id,
    organizationId: expense.organizationId,
    departmentId: expense.departmentId,
    requesterId: expense.toProps().source.actorId,
    amountMinorUnits: expense.amount.minorUnits,
  };
}