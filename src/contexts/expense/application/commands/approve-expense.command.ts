// src/contexts/expense/application/commands/approve-expense.command.ts
// ApproveExpenseCommand is a simple DTO that encapsulates the data needed to approve an expense. It is used by the ApproveExpenseHandler to execute the approval logic.
export class ApproveExpenseCommand {
  constructor(
    readonly expenseId: string,
    readonly organizationId: string,
    readonly approverId: string,
  ) {}
}
