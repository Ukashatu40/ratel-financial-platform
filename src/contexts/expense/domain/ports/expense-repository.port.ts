// src/contexts/expense/domain/ports/expense-repository.port.ts
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { Expense } from '../aggregates/expense.aggregate';

export interface ExpenseRepository {
  findById(id: string, tx?: TransactionClient): Promise<Expense | null>;
  save(expense: Expense, tx: TransactionClient): Promise<void>;
  nextExpenseNumber(organizationId: string, tx?: TransactionClient): Promise<string>;
}

export const EXPENSE_REPOSITORY = Symbol('EXPENSE_REPOSITORY');