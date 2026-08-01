// src/contexts/payroll/application/mappers/payroll-run-to-approvable.mapper.ts
import { Approvable } from '../../../../shared-kernel/workflow/approvable';
import { PayrollRun } from '../../domain/aggregates/payroll-run.aggregate';

export function payrollRunToApprovable(run: PayrollRun, currency: string): Approvable {
  return {
    id: run.id,
    organizationId: run.organizationId,
    // deliberately no departmentId — payroll approval is org-wide, not
    // department-scoped, which PayrollApprovalPolicy (next piece) will
    // reflect by never resolving a 'department' scope step, unlike Expense's
    departmentId: undefined,
    requesterId: run.createdById,
    amountMinorUnits: run.totalGrossPay(currency).minorUnits,
  };
}