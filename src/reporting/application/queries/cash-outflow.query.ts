// src/reporting/application/queries/cash-outflow.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class CashOutflowQuery {
  constructor(
    readonly requestingUser: UserPrincipal,
    readonly from: Date,
    readonly to: Date,
  ) {}
}
