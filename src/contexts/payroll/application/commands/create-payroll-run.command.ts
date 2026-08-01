// src/contexts/payroll/application/commands/create-payroll-run.command.ts
export class CreatePayrollRunCommand {
  constructor(
    readonly organizationId: string,
    readonly runMonth: Date,
    readonly createdById: string,
  ) {}
}