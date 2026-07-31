// src/contexts/expense/application/commands/reject-expense.command.ts
export class RejectExpenseCommand {
  constructor(
    readonly expenseId: string,
    readonly organizationId: string,
    readonly approverId: string,
    readonly reason: string,
  ) {}
}