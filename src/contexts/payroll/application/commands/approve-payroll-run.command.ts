// src/contexts/payroll/application/commands/approve-payroll-run.command.ts
export class ApprovePayrollRunCommand {
  constructor(readonly payrollRunId: string, readonly organizationId: string, readonly approverId: string) {}
}