// test/unit/contexts/expense/expense-adjustment-approval.policy.spec.ts
import { ExpenseAdjustmentApprovalPolicy } from '../../../../src/contexts/expense/infrastructure/policies/expense-adjustment-approval.policy';
import { describe, expect, it, beforeEach } from '@jest/globals';

/**
 * Companion to expense-approval.policy.spec.ts. Redesigned from a fixed
 * ₦1,000,000 magnitude threshold (TECH_DEBT #10) to a pure directional
 * rule: approval is required if, and only if, the corrected amount is
 * GREATER than the original. No magnitude floor — a ₦1 increase requires
 * approval exactly like a ₦10,000,000 one; a decrease of any size,
 * including a full reversal to zero, does not.
 *
 * Amounts are written in naira and converted, so the kobo relationship is
 * asserted rather than implied.
 */
const naira = (amount: bigint): bigint => amount * 100n;

describe('ExpenseAdjustmentApprovalPolicy', () => {
  let policy: ExpenseAdjustmentApprovalPolicy;

  beforeEach(() => {
    policy = new ExpenseAdjustmentApprovalPolicy();
  });

  describe('increases — require approval, regardless of magnitude', () => {
    it('requires approval for a one-kobo increase', () => {
      expect(policy.requiresApproval(naira(100n) + 1n, naira(100n), 'tiny correction')).toBe(true);
    });

    it('requires approval for a huge increase', () => {
      expect(policy.requiresApproval(naira(10_000_000n), naira(1n), 'huge correction')).toBe(true);
    });

    it('requires approval for an increase from a zero original', () => {
      expect(policy.requiresApproval(naira(1_000n), 0n, 'first real amount recorded')).toBe(true);
    });
  });

  describe('decreases and full reversals — never require approval, regardless of magnitude', () => {
    it('does not require approval for a one-kobo decrease', () => {
      expect(policy.requiresApproval(naira(100n) - 1n, naira(100n), 'tiny correction')).toBe(false);
    });

    it('does not require approval for a huge decrease', () => {
      expect(policy.requiresApproval(naira(1n), naira(10_000_000n), 'huge correction')).toBe(false);
    });

    it('does not require approval for a full reversal to zero, no matter the original size', () => {
      expect(policy.requiresApproval(0n, naira(10_000_000n), 'full void')).toBe(false);
    });
  });

  describe('no change', () => {
    it('does not require approval when the new amount equals the original', () => {
      // In practice Expense.createAdjustment() rejects this case entirely
      // (NoOpAdjustmentError) before this policy would ever be asked — but
      // the policy's own comparison (`>`) is false for equal values
      // regardless, so this is pinned directly rather than only implied.
      expect(policy.requiresApproval(naira(500_000n), naira(500_000n), 'no actual change')).toBe(
        false,
      );
    });
  });

  it('sets the rule on the comparison, NOT a ₦1,000,000 magnitude floor (TECH_DEBT #10)', () => {
    // The regression pin for the OLD design: under the previous fixed
    // threshold, none of these small increases would have required
    // approval at all. Under the new rule, every increase does.
    expect(policy.requiresApproval(naira(100n), naira(50n), 'small increase')).toBe(true);
    expect(policy.requiresApproval(naira(100_000n), naira(99_999n), 'small increase')).toBe(true);
    // And, symmetrically, the old design WOULD have required approval for
    // a decrease past ₦1,000,000 — the new rule never does.
    expect(policy.requiresApproval(naira(1n), naira(5_000_000n), 'huge decrease')).toBe(false);
  });

  it('ignores the reason string entirely', () => {
    // `reason` is accepted but deliberately unused (`_reason`). Pinning that
    // means a future policy that DOES branch on reason has to change this
    // expectation rather than silently changing behaviour.
    for (const reason of ['typo', '', 'FRAUD', 'a'.repeat(500)]) {
      expect(policy.requiresApproval(naira(200n), naira(100n), reason)).toBe(true);
      expect(policy.requiresApproval(naira(100n), naira(200n), reason)).toBe(false);
    }
  });
});
