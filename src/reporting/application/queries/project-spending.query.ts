// src/reporting/application/queries/project-spending.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class ProjectSpendingQuery {
  constructor(
    readonly requestingUser: UserPrincipal,
    readonly from: Date,
    readonly to: Date,
  ) {}
}
