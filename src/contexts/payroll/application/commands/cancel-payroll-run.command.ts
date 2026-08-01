// src/contexts/payroll/application/commands/cancel-payroll-run.command.ts
export class CancelPayrollRunCommand {
  constructor(readonly payrollRunId: string, readonly organizationId: string, readonly actorId: string) {}
}