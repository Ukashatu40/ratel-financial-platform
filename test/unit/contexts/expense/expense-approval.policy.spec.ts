// test/unit/contexts/expense/expense-approval.policy.spec.ts
import { ExpenseApprovalPolicy } from '../../../../src/contexts/expense/infrastructure/policies/expense-approval.policy';
import { Approvable } from '../../../../src/shared-kernel/workflow/approvable';
import { describe, expect, it, beforeEach } from '@jest/globals';

/**
 * This policy decides the approval chain shape and had NO test coverage at
 * all until TECH_DEBT #10 — which is how the original threshold constant
 * shipped 10x too small. The policy has since been redesigned around a
 * confirmed three-tier business rule (still TECH_DEBT #10, now RESOLVED):
 *   - <= ₦100,000: department_head alone, scoped to the expense's own department.
 *   - > ₦100,000 and < ₦1,000,000: a panel of 3 DIFFERENT department_heads.
 *   - >= ₦1,000,000: the same panel, PLUS finance_director.
 *
 * Every amount below is expressed in NAIRA and converted here, so the kobo
 * relationship is asserted rather than implied — the exact discipline that
 * would have caught the original 10x defect.
 */
const naira = (amount: bigint): bigint => amount * 100n;

const soleDepartmentHeadStep = {
  order: 1,
  requiredRole: 'department_head',
  requiredScope: 'department',
};

const panelSeat = (order: number) => ({
  order,
  requiredRole: 'department_head',
  requiredScope: 'organization',
});

const financeDirectorStep = (order: number) => ({
  order,
  requiredRole: 'finance_director',
  requiredScope: 'organization',
});

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

  describe('tier 1 — sole department_head, <= ₦100,000', () => {
    it('resolves a single department-scoped step just below the threshold', () => {
      const chain = policy.resolveChain(expenseOf(naira(99_999n)));
      expect(chain.toArray()).toEqual([soleDepartmentHeadStep]);
    });

    it('resolves a single step EXACTLY AT ₦100,000 — the tier boundary belongs to tier 1', () => {
      const chain = policy.resolveChain(expenseOf(naira(100_000n)));
      expect(chain.toArray()).toEqual([soleDepartmentHeadStep]);
    });

    it('resolves a single step for a zero-amount expense', () => {
      expect(policy.resolveChain(expenseOf(0n)).toArray()).toEqual([soleDepartmentHeadStep]);
    });
  });

  describe('tier 2 — 3-department_head panel, > ₦100,000 and < ₦1,000,000', () => {
    it('escalates to the 3-seat panel one kobo above ₦100,000', () => {
      const chain = policy.resolveChain(expenseOf(naira(100_000n) + 1n));
      expect(chain.toArray()).toEqual([panelSeat(1), panelSeat(2), panelSeat(3)]);
    });

    it('stays at the 3-seat panel just below ₦1,000,000', () => {
      const chain = policy.resolveChain(expenseOf(naira(999_999n)));
      expect(chain.length).toBe(3);
      expect(chain.toArray().every((s) => s.requiredRole === 'department_head')).toBe(true);
    });

    it('every panel seat is organization-scoped, not the expense\'s own department — a department normally has one head, so 3 DIFFERENT heads cannot come from a single department', () => {
      const chain = policy.resolveChain(expenseOf(naira(500_000n)));
      expect(chain.toArray().every((s) => s.requiredScope === 'organization')).toBe(true);
    });
  });

  describe('tier 3 — panel + finance_director, >= ₦1,000,000', () => {
    it('adds finance_director EXACTLY AT ₦1,000,000 — the tier boundary belongs to tier 3', () => {
      const chain = policy.resolveChain(expenseOf(naira(1_000_000n)));
      expect(chain.toArray()).toEqual([
        panelSeat(1),
        panelSeat(2),
        panelSeat(3),
        financeDirectorStep(4),
      ]);
      expect(chain.isLastStep(4)).toBe(true);
    });

    it('adds finance_director for amounts well above the threshold', () => {
      const chain = policy.resolveChain(expenseOf(naira(10_000_000n)));
      expect(chain.length).toBe(4);
      expect(chain.stepAt(4)).toEqual(financeDirectorStep(4));
    });
  });

  describe('resolved chain shape', () => {
    it('never resolves an empty chain, so an expense is never auto-approved', () => {
      for (const amount of [0n, naira(1n), naira(100_000n), naira(500_000n), naira(10_000_000n)]) {
        expect(policy.resolveChain(expenseOf(amount)).isEmpty()).toBe(false);
      }
    });

    it('the panel always precedes finance_director, in order', () => {
      const chain = policy.resolveChain(expenseOf(naira(2_000_000n))).toArray();
      expect(chain.slice(0, 3).every((s) => s.requiredRole === 'department_head')).toBe(true);
      expect(chain[3].requiredRole).toBe('finance_director');
    });
  });

  describe('negative amounts — TECH_DEBT #58 (adjustments carry a signed delta)', () => {
    // Expense.createAdjustment() persists the DELTA (newAmount - original),
    // which can be negative (a decrease). ExpenseAdjustmentApprovalPolicy
    // never routes a decrease through this policy in practice (decreases
    // are always auto-approved, so resolveChainFor() is never called for
    // one) — but this policy is a general-purpose ApprovalPolicy consumed
    // by more than one caller, and the absolute-value guard is cheap
    // insurance against a FUTURE caller passing a negative value, so its
    // symmetry is still worth pinning directly.
    it('produces the SAME chain for a positive amount and its negation, at every tier boundary', () => {
      for (const amount of [
        0n,
        naira(1_000n),
        naira(100_000n),
        naira(100_000n) + 1n,
        naira(999_999n),
        naira(1_000_000n),
        naira(10_000_000n),
      ]) {
        const positiveChain = policy.resolveChain(expenseOf(amount)).toArray();
        const negativeChain = policy.resolveChain(expenseOf(-amount)).toArray();
        expect(negativeChain).toEqual(positiveChain);
      }
    });
  });
});
