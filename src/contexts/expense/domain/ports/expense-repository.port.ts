// src/contexts/expense/domain/ports/expense-repository.port.ts
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { Expense } from '../aggregates/expense.aggregate';
import { ExpenseStatusValue } from '../value-objects/expense-status';
import { Cursor, Page } from '../../../../shared-kernel/pagination/cursor';

export interface ExpenseListFilter {
  organizationId: string;
  departmentIds?: string[]; // present when caller is department-scoped
  requesterId?: string; // present when caller is own-scoped
  status?: ExpenseStatusValue[];
  cursor?: Cursor;
  limit: number;
}

export interface ExpenseRepository {
  findById(id: string, tx?: TransactionClient): Promise<Expense | null>;
  findMany(filter: ExpenseListFilter): Promise<Page<Expense>>; // <-- new
  save(expense: Expense, tx: TransactionClient): Promise<void>;
  nextExpenseNumber(organizationId: string, tx?: TransactionClient): Promise<string>;
}

export const EXPENSE_REPOSITORY = Symbol('EXPENSE_REPOSITORY');
