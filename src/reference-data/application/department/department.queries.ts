// src/reference-data/application/department/department.queries.ts
export class GetDepartmentByIdQuery {
  constructor(
    readonly departmentId: string,
    readonly organizationId: string,
  ) {}
}
export class ListDepartmentsQuery {
  constructor(
    readonly organizationId: string,
    readonly includeInactive: boolean = false,
  ) {}
}
