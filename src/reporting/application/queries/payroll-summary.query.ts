// src/reporting/application/queries/payroll-summary.query.ts
export class PayrollSummaryQuery {
  constructor(
    readonly organizationId: string,
    readonly from: Date,
    readonly to: Date,
  ) {}
}
