// src/contexts/payroll/application/commands/add-payslip.command.ts
import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';

export class AddPayslipCommand {
  constructor(
    readonly payrollRunId: string,
    readonly organizationId: string,
    readonly employeeId: string,
    // one-off items for THIS run only (a bonus, a specific month's loan
    // repayment) — layered on top of the employee's recurring
    // SalaryStructure line items, never persisted back into the structure itself
    readonly additionalLineItems: SalaryLineItem[] = [],
  ) {}
}