// src/contexts/expense/application/queries/list-expenses.query.ts
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';
import { ExpenseStatusValue } from '../../domain/value-objects/expense-status';

export class ListExpensesQuery {
  constructor(
    readonly requestingUser: UserPrincipal,
    readonly status?: ExpenseStatusValue[],
    readonly cursor?: string,
    readonly limit: number = 25,
  ) {}
}
