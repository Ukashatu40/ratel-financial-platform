// src/reporting/application/queries/expense-adjustments-summary.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class ExpenseAdjustmentsSummaryQuery {
  constructor(
    public readonly requestingUser: UserPrincipal,
    public readonly from: Date,
    public readonly to: Date,
  ) {}
}
