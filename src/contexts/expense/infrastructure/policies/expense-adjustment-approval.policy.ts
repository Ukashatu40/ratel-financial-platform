// src/contexts/expense/infrastructure/policies/expense-adjustment-approval.policy.ts
import { Injectable } from '@nestjs/common';
import { AdjustmentApprovalPolicy } from '../../../../shared-kernel/workflow/adjustment-approval-policy.port';

/**
 * Redesigned, not just re-thresholded: this used to gate on the ABSOLUTE
 * SIZE of the adjustment against a fixed ₦1,000,000 figure (TECH_DEBT #10),
 * regardless of direction — a huge correction DOWN needed exactly the same
 * sign-off as a huge correction UP. Replaced with a pure directional rule:
 * approval is required if, and only if, the corrected amount is GREATER
 * than what was originally recorded. A correction that reduces or exactly
 * repeats the original amount is a conservative move (never a NEW
 * commitment of funds beyond what was already approved) and is
 * auto-approved regardless of size; an increase — by any amount, even one
 * kobo — is a genuinely new commitment and always needs sign-off. No
 * magnitude floor: "only ... when greater than the previous amount" was
 * the explicit instruction, not "greater than previous AND above some
 * threshold."
 *
 * `newAmountMinorUnits === originalAmountMinorUnits` (no actual change) is
 * rejected earlier, at the aggregate (Expense.createAdjustment() throws
 * NoOpAdjustmentError) — this method never needs to special-case it, since
 * `>` is already false for equal values either way.
 */
@Injectable()
export class ExpenseAdjustmentApprovalPolicy implements AdjustmentApprovalPolicy {
  requiresApproval(
    newAmountMinorUnits: bigint,
    originalAmountMinorUnits: bigint,
    _reason: string,
  ): boolean {
    return newAmountMinorUnits > originalAmountMinorUnits;
  }
}
