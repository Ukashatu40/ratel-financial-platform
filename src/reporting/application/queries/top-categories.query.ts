// src/reporting/application/queries/top-categories.query.ts
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';

export class TopCategoriesQuery {
  constructor(
    readonly requestingUser: UserPrincipal,
    readonly from: Date,
    readonly to: Date,
    readonly limit: number = 10,
  ) {}
}
