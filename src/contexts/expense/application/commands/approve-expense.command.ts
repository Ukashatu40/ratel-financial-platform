// src/contexts/expense/application/commands/approve-expense.command.ts
export class ApproveExpenseCommand {
  constructor(readonly expenseId: string, readonly organizationId: string, readonly approverId: string) {}
}