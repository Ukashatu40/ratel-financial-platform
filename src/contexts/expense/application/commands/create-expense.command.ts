// src/contexts/expense/application/commands/create-expense.command.ts
import { ExpenseSource } from '../../domain/value-objects/expense-source';

export class CreateExpenseCommand {
  constructor(
    readonly organizationId: string,
    readonly source: ExpenseSource,
    readonly amountMinorUnits: bigint,
    readonly currency: string,
    readonly categoryId: string,
    readonly departmentId: string,
    readonly expenseDate: Date,
    readonly vendorId?: string,
    readonly projectId?: string,
    readonly description?: string,
  ) {}
}