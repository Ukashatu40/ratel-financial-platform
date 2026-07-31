// src/shared-kernel/workflow/adjustment-approval-policy.port.ts
/**
 * Separate from ApprovalPolicy deliberately — resolving "what chain does
 * this need" (ApprovalPolicy) is a different question from "does THIS
 * adjustment need to go through a chain at all" (this port). An adjustment
 * that requires approval still uses ApprovalPolicy afterward to resolve
 * which chain.
 */
export interface AdjustmentApprovalPolicy {
  requiresApproval(amountMinorUnits: bigint, reason: string): boolean;
}

export const ADJUSTMENT_APPROVAL_POLICY = Symbol('ADJUSTMENT_APPROVAL_POLICY');