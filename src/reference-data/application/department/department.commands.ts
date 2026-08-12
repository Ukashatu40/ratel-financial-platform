// src/reference-data/application/department/department.commands.ts
export class CreateDepartmentCommand {
  constructor(
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class UpdateDepartmentCommand {
  constructor(
    readonly departmentId: string,
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class DeactivateDepartmentCommand {
  constructor(
    readonly departmentId: string,
    readonly organizationId: string,
    readonly actorId: string,
  ) {}
}
