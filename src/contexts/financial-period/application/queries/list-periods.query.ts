// src/contexts/financial-period/application/queries/list-periods.query.ts
import { PeriodStatusValue } from '../../domain/value-objects/period-status';

export class ListPeriodsQuery {
  constructor(
    readonly organizationId: string,
    /** undefined means every status — notably including closed, which is the point. */
    readonly status?: PeriodStatusValue,
  ) {}
}
