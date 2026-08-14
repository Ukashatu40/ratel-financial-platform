// src/contexts/payroll/application/employee/employee.commands.ts
export class CreateEmployeeCommand {
  constructor(
    readonly organizationId: string,
    readonly fullName: string,
  ) {}
}
export class LinkEmployeeToUserCommand {
  constructor(
    readonly employeeId: string,
    readonly organizationId: string,
    readonly userId: string,
  ) {}
}
export class UnlinkEmployeeFromUserCommand {
  constructor(
    readonly employeeId: string,
    readonly organizationId: string,
  ) {}
}
export class DeactivateEmployeeCommand {
  constructor(
    readonly employeeId: string,
    readonly organizationId: string,
    readonly actorId: string,
  ) {}
}
