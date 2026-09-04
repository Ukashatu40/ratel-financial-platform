// test/unit/contexts/expense/expense-approval.policy.spec.ts
import { ExpenseApprovalPolicy } from '../../../../src/contexts/expense/infrastructure/policies/expense-approval.policy';
import { Approvable } from '../../../../src/shared-kernel/workflow/approvable';
import { describe, expect, it, beforeEach } from '@jest/globals';

/**
 * This policy decides whether an expense needs one approval or two, and had
 * NO test coverage at all until TECH_DEBT #10 — `resolveChain()` was never
 * invoked by any spec, and its two-step branch had never executed. That is
 * how the threshold constant shipped 10x too small (₦50,000 instead of the
 * documented ₦500,000).
 *
 * Every amount below is therefore expressed in NAIRA and converted here, so
 * the kobo relationship is asserted rather than implied. Writing a bare kobo
 * literal in a test would let the same missing-digit mistake pass again.
 */
const naira = (amount: bigint): bigint => amount * 100n;

const DEPARTMENT_HEAD_STEP = {
  order: 1,
  requiredRole: 'department_head',
  requiredScope: 'department',
};
const FINANCE_DIRECTOR_STEP = {
  order: 2,
  requiredRole: 'finance_director',
  requiredScope: 'organization',
};

describe('ExpenseApprovalPolicy', () => {
  let policy: ExpenseApprovalPolicy;

  beforeEach(() => {
    policy = new ExpenseApprovalPolicy();
  });

  // Positional amount only, deliberately: an overrides object here would have
  // to use `'key' in overrides` per CLAUDE.md convention #4, and nothing in
  // this policy reads any other field.
  const expenseOf = (amountMinorUnits: bigint): Approvable => ({
    id: 'expense-1',
    organizationId: 'org-1',
    departmentId: 'dept-1',
    requesterId: 'user-1',
    amountMinorUnits,
  });

  describe('the ₦500,000 finance-director escalation threshold', () => {
    it('requires department_head only just BELOW the threshold (₦499,999)', () => {
      const chain = policy.resolveChain(expenseOf(naira(499_999n)));
      expect(chain.length).toBe(1);
    });

    it('escalates EXACTLY AT the threshold (₦500,000)', () => {
      // Pins the `<` boundary in resolveChain: at-threshold escalates.
      const chain = policy.resolveChain(expenseOf(naira(500_000n)));
      expect(chain.length).toBe(2);
    });

    it('escalates one kobo above the threshold', () => {
      const chain = policy.resolveChain(expenseOf(naira(500_000n) + 1n));
      expect(chain.length).toBe(2);
    });

    it('sets the escalation point at ₦500,000, NOT ₦50,000 (TECH_DEBT #10)', () => {
      // The regression pin for the 10x defect. Under the old constant
      // (50_000_00n = ₦50,000) every one of these needed a second approval.
      expect(policy.resolveChain(expenseOf(naira(50_000n))).length).toBe(1);
      expect(policy.resolveChain(expenseOf(naira(100_000n))).length).toBe(1);
      expect(policy.resolveChain(expenseOf(naira(499_999n))).length).toBe(1);
    });

    it('requires department_head only for a zero-amount expense', () => {
      const chain = policy.resolveChain(expenseOf(0n));
      expect(chain.length).toBe(1);
    });
  });

  describe('resolved chain shape', () => {
    // Asserting the exact step objects, not just the count, so a future
    // widening of either chain has to change an expectation deliberately
    // rather than slipping through — the discipline TECH_DEBT #21 introduced.
    it('below threshold: a single department-scoped department_head step', () => {
      const chain = policy.resolveChain(expenseOf(naira(1_000n)));
      expect(chain.toArray()).toEqual([DEPARTMENT_HEAD_STEP]);
    });

    it('at or above threshold: department_head THEN finance_director, in that order', () => {
      const chain = policy.resolveChain(expenseOf(naira(750_000n)));
      expect(chain.toArray()).toEqual([DEPARTMENT_HEAD_STEP, FINANCE_DIRECTOR_STEP]);
      expect(chain.isLastStep(2)).toBe(true);
    });

    it('never resolves an empty chain, so an expense is never auto-approved', () => {
      // SubmitExpenseHandler auto-approves on an empty chain; this policy must
      // never produce one, at any amount.
      for (const amount of [0n, naira(1n), naira(500_000n), naira(10_000_000n)]) {
        expect(policy.resolveChain(expenseOf(amount)).isEmpty()).toBe(false);
      }
    });
  });

  describe('negative amounts — TECH_DEBT #58 (adjustments carry a negated Money value)', () => {
    // Expense.createAdjustment() sets amount to original.amount.negate(), so
    // every adjustment reaches this policy with a NEGATIVE amountMinorUnits.
    // The bare `<` comparison previously meant any negative value was always
    // below the positive threshold, so a large reversal silently never
    // escalated to finance_director.

    it('escalates a large NEGATIVE amount exactly the same as its positive counterpart', () => {
      // The regression case itself — a -₦1,500,000 reversal must escalate,
      // not silently resolve to department_head alone.
      const chain = policy.resolveChain(expenseOf(-naira(1_500_000n)));
      expect(chain.length).toBe(2);
      expect(chain.toArray()).toEqual([DEPARTMENT_HEAD_STEP, FINANCE_DIRECTOR_STEP]);
    });

    it('does NOT escalate a small negative amount, matching its positive counterpart', () => {
      const chain = policy.resolveChain(expenseOf(-naira(100_000n)));
      expect(chain.length).toBe(1);
      expect(chain.toArray()).toEqual([DEPARTMENT_HEAD_STEP]);
    });

    it('escalates EXACTLY AT the threshold for a negative amount too', () => {
      const chain = policy.resolveChain(expenseOf(-naira(500_000n)));
      expect(chain.length).toBe(2);
    });

    it('does not escalate one kobo below the threshold, negative side', () => {
      const chain = policy.resolveChain(expenseOf(-(naira(500_000n) - 1n)));
      expect(chain.length).toBe(1);
    });

    it('produces the SAME chain for a positive amount and its negation, at every magnitude tested elsewhere', () => {
      // A direct symmetry check across the same amounts this file already
      // exercises for the positive case, so the fix is proven equivalent
      // rather than merely non-crashing.
      for (const amount of [
        0n,
        naira(1_000n),
        naira(499_999n),
        naira(500_000n),
        naira(10_000_000n),
      ]) {
        const positiveChain = policy.resolveChain(expenseOf(amount)).toArray();
        const negativeChain = policy.resolveChain(expenseOf(-amount)).toArray();
        expect(negativeChain).toEqual(positiveChain);
      }
    });
  });
});
