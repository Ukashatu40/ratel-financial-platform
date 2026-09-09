// src/shared-kernel/workflow/adjustment-approval-policy.port.ts
/**
 * Separate from ApprovalPolicy deliberately — resolving "what chain does
 * this need" (ApprovalPolicy) is a different question from "does THIS
 * adjustment need to go through a chain at all" (this port). An adjustment
 * that requires approval still uses ApprovalPolicy afterward to resolve
 * which chain (using the DELTA's magnitude — see
 * Expense.createAdjustment()).
 *
 * `newAmountMinorUnits`/`originalAmountMinorUnits` are passed separately,
 * deliberately, rather than a pre-computed signed delta — this is the same
 * class of bug TECH_DEBT #58 already recorded once (a signed value handled
 * incorrectly at a sign boundary): making the caller compute a delta and
 * hand it over creates a second place that could get the sign wrong.
 * Comparing two unsigned magnitudes directly here cannot.
 */
export interface AdjustmentApprovalPolicy {
  requiresApproval(
    newAmountMinorUnits: bigint,
    originalAmountMinorUnits: bigint,
    reason: string,
  ): boolean;
}

export const ADJUSTMENT_APPROVAL_POLICY = Symbol('ADJUSTMENT_APPROVAL_POLICY');