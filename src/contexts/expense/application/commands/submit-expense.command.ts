// src/contexts/expense/application/commands/submit-expense.command.ts
export class SubmitExpenseCommand {
  constructor(readonly expenseId: string, readonly organizationId: string) {}
}