// src/contexts/payroll/application/commands/reject-payroll-run.command.ts
export class RejectPayrollRunCommand {
  constructor(
    readonly payrollRunId: string,
    readonly organizationId: string,
    readonly approverId: string,
    readonly reason: string,
  ) {}
}