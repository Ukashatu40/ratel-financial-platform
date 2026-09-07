// src/reporting/application/queries/expense-status-breakdown.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class ExpenseStatusBreakdownQuery {
  constructor(
    public readonly requestingUser: UserPrincipal,
    public readonly from: Date,
    public readonly to: Date,
  ) {}
}
