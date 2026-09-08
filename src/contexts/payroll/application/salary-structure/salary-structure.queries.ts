// src/contexts/payroll/application/salary-structure/salary-structure.queries.ts
export class GetActiveSalaryStructureQuery {
  constructor(
    public readonly employeeId: string,
    public readonly organizationId: string,
  ) {}
}
