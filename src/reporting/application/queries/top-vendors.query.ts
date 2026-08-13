// src/reporting/application/queries/top-vendors.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class TopVendorsQuery {
  constructor(
    readonly requestingUser: UserPrincipal,
    readonly from: Date,
    readonly to: Date,
    readonly limit: number = 10,
  ) {}
}
