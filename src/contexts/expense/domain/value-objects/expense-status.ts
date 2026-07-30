// src/contexts/expense/domain/value-objects/expense-status.ts
export type ExpenseStatusValue =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'closed';

export const MUTABLE_STATUSES: readonly ExpenseStatusValue[] = ['draft'];