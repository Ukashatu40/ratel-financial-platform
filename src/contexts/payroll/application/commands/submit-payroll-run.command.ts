// src/contexts/payroll/application/commands/submit-payroll-run.command.ts
export class SubmitPayrollRunCommand {
  constructor(readonly payrollRunId: string, readonly organizationId: string) {}
}