// src/reporting/application/queries/department-spending-summary.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class DepartmentSpendingSummaryQuery {
  constructor(
    readonly requestingUser: UserPrincipal,
    readonly from: Date,
    readonly to: Date,
  ) {}
}
