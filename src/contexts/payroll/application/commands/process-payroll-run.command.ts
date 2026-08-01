// src/contexts/payroll/application/commands/process-payroll-run.command.ts
export class ProcessPayrollRunCommand {
  constructor(readonly payrollRunId: string, readonly organizationId: string) {}
}