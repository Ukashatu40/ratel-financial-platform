// src/contexts/expense/application/queries/get-expense-by-id.query.ts
export class GetExpenseByIdQuery {
  constructor(
    readonly expenseId: string,
    readonly organizationId: string,
  ) {}
}
