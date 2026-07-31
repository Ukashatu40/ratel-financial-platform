// src/shared-kernel/workflow/approval-policy.port.ts
import { Approvable } from './approvable';
import { ApprovalChain } from './approval-chain';

/**
 * Pure domain logic: given an Approvable, decide what chain of approvals
 * it requires. Each bounded context provides its OWN implementation
 * (ExpenseApprovalPolicy, PayrollApprovalPolicy) — this is the injection
 * seam that lets Expense and Payroll share the engine below without
 * sharing business rules (Phase 2.2, confirmed decision: separate context,
 * shared framework).
 */
export interface ApprovalPolicy {
  resolveChain(item: Approvable): ApprovalChain;
}

export const APPROVAL_POLICY = Symbol('APPROVAL_POLICY');