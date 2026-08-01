// src/contexts/payroll/domain/value-objects/payroll-run-status.ts
// src/contexts/payroll/domain/value-objects/payroll-run-status.ts
export type PayrollRunStatusValue =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'cancelled';

export const MUTABLE_RUN_STATUSES: readonly PayrollRunStatusValue[] = ['draft'];