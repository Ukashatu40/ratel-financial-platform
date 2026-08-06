// src/contexts/payroll/application/queries/list-payroll-runs.query.ts
export class ListPayrollRunsQuery {
  constructor(
    readonly organizationId: string,
    readonly cursor?: string,
    readonly limit: number = 25,
  ) {}
}
