// src/contexts/expense/application/commands/cancel-expense.command.ts
export class CancelExpenseCommand {
  constructor(readonly expenseId: string, readonly organizationId: string, readonly actorId: string) {}
}