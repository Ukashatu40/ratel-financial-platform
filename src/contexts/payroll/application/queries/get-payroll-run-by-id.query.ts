// src/contexts/payroll/application/queries/get-payroll-run-by-id.query.ts
export class GetPayrollRunByIdQuery {
  constructor(
    readonly runId: string,
    readonly organizationId: string,
  ) {}
}
