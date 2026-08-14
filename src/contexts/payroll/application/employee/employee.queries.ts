// src/contexts/payroll/application/employee/employee.queries.ts
export class GetEmployeeByIdQuery {
  constructor(
    readonly employeeId: string,
    readonly organizationId: string,
  ) {}
}
export class ListEmployeesQuery {
  constructor(
    readonly organizationId: string,
    readonly includeInactive: boolean = false,
  ) {}
}
