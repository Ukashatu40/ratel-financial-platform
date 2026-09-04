// src/reporting/application/queries/requester-spending.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class RequesterSpendingQuery {
  constructor(
    public readonly requestingUser: UserPrincipal,
    public readonly from: Date,
    public readonly to: Date,
  ) {}
}
