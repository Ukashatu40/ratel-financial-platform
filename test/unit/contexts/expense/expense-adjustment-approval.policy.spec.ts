// test/unit/contexts/expense/expense-adjustment-approval.policy.spec.ts
import { ExpenseAdjustmentApprovalPolicy } from '../../../../src/contexts/expense/infrastructure/policies/expense-adjustment-approval.policy';
import { describe, expect, it, beforeEach } from '@jest/globals';

/**
 * Companion to expense-approval.policy.spec.ts. This policy answers "does
 * this adjustment need re-approval at all" and, like its sibling, had no
 * coverage until TECH_DEBT #10 — which is how its constant shipped 10x too
 * small (₦100,000 instead of the documented ₦1,000,000).
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

  describe('the ₦1,000,000 re-approval threshold', () => {
    it('does not require approval just BELOW the threshold (₦999,999)', () => {
      expect(policy.requiresApproval(naira(999_999n), 'correction')).toBe(false);
    });

    it('requires approval EXACTLY AT the threshold (₦1,000,000)', () => {
      // Pins the `>=` boundary: at-threshold requires approval.
      expect(policy.requiresApproval(naira(1_000_000n), 'correction')).toBe(true);
    });

    it('requires approval one kobo above the threshold', () => {
      expect(policy.requiresApproval(naira(1_000_000n) + 1n, 'correction')).toBe(true);
    });

    it('sets the threshold at ₦1,000,000, NOT ₦100,000 (TECH_DEBT #10)', () => {
      // The regression pin for the 10x defect. Under the old constant
      // (100_000_00n = ₦100,000) every one of these wrongly required
      // re-approval.
      expect(policy.requiresApproval(naira(100_000n), 'correction')).toBe(false);
      expect(policy.requiresApproval(naira(500_000n), 'correction')).toBe(false);
      expect(policy.requiresApproval(naira(999_999n), 'correction')).toBe(false);
    });

    it('does not require approval for a zero adjustment', () => {
      expect(policy.requiresApproval(0n, 'no-op')).toBe(false);
    });
  });

  describe('negative adjustments (reversals)', () => {
    // The policy compares the ABSOLUTE value, so a large reversal escalates
    // exactly like a large increase. Nothing covered this branch before.
    it('requires approval for a large negative adjustment', () => {
      expect(policy.requiresApproval(-naira(1_000_000n), 'reversal')).toBe(true);
      expect(policy.requiresApproval(-naira(5_000_000n), 'reversal')).toBe(true);
    });

    it('does not require approval for a small negative adjustment', () => {
      expect(policy.requiresApproval(-naira(999_999n), 'reversal')).toBe(false);
    });

    it('treats a negative and positive adjustment of equal magnitude identically', () => {
      const magnitude = naira(2_000_000n);
      expect(policy.requiresApproval(-magnitude, 'reversal')).toBe(
        policy.requiresApproval(magnitude, 'increase'),
      );
    });
  });

  it('ignores the reason string entirely', () => {
    // `reason` is accepted but deliberately unused (`_reason`). Pinning that
    // means a future policy that DOES branch on reason has to change this
    // expectation rather than silently changing behaviour.
    const belowThreshold = naira(1_000n);
    for (const reason of ['typo', '', 'FRAUD', 'a'.repeat(500)]) {
      expect(policy.requiresApproval(belowThreshold, reason)).toBe(false);
    }
  });
});
