// src/reporting/application/queries/pending-department-spending.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class PendingDepartmentSpendingQuery {
  constructor(
    public readonly requestingUser: UserPrincipal,
    public readonly from: Date,
    public readonly to: Date,
  ) {}
}
