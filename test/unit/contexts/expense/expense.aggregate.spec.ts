// test/unit/contexts/expense/expense.aggregate.spec.ts
import {
  AdjustmentReasonRequiredError,
  Expense,
  ExpenseNotMutableError,
  InvalidAdjustmentAmountError,
  NoOpAdjustmentError,
} from '../../../../src/contexts/expense/domain/aggregates/expense.aggregate';
import { InvalidStateTransitionError } from '../../../../src/shared-kernel/errors/domain-error';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { humanSource } from '../../../../src/contexts/expense/domain/value-objects/expense-source';
import { describe, expect, it } from '@jest/globals';

function buildDraftExpense() {
  return Expense.create({
    organizationId: 'org-1',
    expenseNumber: 'EXP-000001',
    source: humanSource('employee', 'user-1'),
    amount: Money.of(50000n, 'NGN'),
    categoryId: 'cat-1',
    departmentId: 'dept-1',
    periodId: 'period-1',
    expenseDate: new Date('2026-08-01'),
  });
}

describe('Expense aggregate', () => {
  describe('create()', () => {
    it('starts in draft status', () => {
      const expense = buildDraftExpense();
      expect(expense.status).toBe('draft');
    });

    it('records an ExpenseDrafted domain event', () => {
      const expense = buildDraftExpense();
      const events = expense.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ExpenseDrafted');
    });

    it('rejects a zero amount', () => {
      expect(() =>
        Expense.create({
          organizationId: 'org-1',
          expenseNumber: 'EXP-000002',
          source: humanSource('employee', 'user-1'),
          amount: Money.zero('NGN'),
          categoryId: 'cat-1',
          departmentId: 'dept-1',
          periodId: 'period-1',
          expenseDate: new Date(),
        }),
      ).toThrow(RangeError);
    });

    it('rejects a negative amount', () => {
      expect(() =>
        Expense.create({
          organizationId: 'org-1',
          expenseNumber: 'EXP-000003',
          source: humanSource('employee', 'user-1'),
          amount: Money.of(-1000n, 'NGN'),
          categoryId: 'cat-1',
          departmentId: 'dept-1',
          periodId: 'period-1',
          expenseDate: new Date(),
        }),
      ).toThrow(RangeError);
    });
  });

  describe('state machine transitions', () => {
    it('draft -> submitForApproval() -> pending_approval', () => {
      const expense = buildDraftExpense();
      expense.pullDomainEvents(); // clear creation event
      expense.submitForApproval();
      expect(expense.status).toBe('pending_approval');
    });

    it('pending_approval -> approve() -> approved', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expense.pullDomainEvents();
      expense.approve('approver-1');
      expect(expense.status).toBe('approved');
    });

    it('pending_approval -> reject() -> rejected', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expense.reject('approver-1', 'insufficient documentation');
      expect(expense.status).toBe('rejected');
    });

    it('rejects submitForApproval() from a non-draft state', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expect(() => expense.submitForApproval()).toThrow(InvalidStateTransitionError);
    });

    it('rejects approve() from draft (must go through pending_approval first)', () => {
      const expense = buildDraftExpense();
      expect(() => expense.approve('approver-1')).toThrow(InvalidStateTransitionError);
    });

    it('rejects reject() on an already-approved expense', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expense.approve('approver-1');
      expect(() => expense.reject('approver-1', 'too late')).toThrow(InvalidStateTransitionError);
    });

    it('allows cancel() from draft', () => {
      const expense = buildDraftExpense();
      expense.cancel('user-1');
      expect(expense.status).toBe('cancelled');
    });

    it('allows cancel() from pending_approval', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expense.cancel('user-1');
      expect(expense.status).toBe('cancelled');
    });

    it('rejects cancel() on an already-approved expense', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expense.approve('approver-1');
      expect(() => expense.cancel('user-1')).toThrow(InvalidStateTransitionError);
    });
  });

  describe('update() — mutability rule', () => {
    it('allows update() while in draft', () => {
      const expense = buildDraftExpense();
      expect(() => expense.update({ description: 'Updated description' })).not.toThrow();
    });

    it('rejects update() once submitted for approval', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expect(() => expense.update({ description: 'Trying to sneak an edit in' })).toThrow(
        ExpenseNotMutableError,
      );
    });

    it('rejects update() once approved', () => {
      const expense = buildDraftExpense();
      expense.submitForApproval();
      expense.approve('approver-1');
      expect(() => expense.update({ description: 'Trying to edit an approved expense' })).toThrow(
        ExpenseNotMutableError,
      );
    });
  });

  describe('createAdjustment()', () => {
    it('requires a non-empty reason', () => {
      const original = buildDraftExpense();
      expect(() =>
        Expense.createAdjustment({
          original,
          reason: '',
          currentOpenPeriodId: 'period-2',
          expenseNumber: 'EXP-ADJ-1',
          newAmountMinorUnits: 80000n,
          requiresApproval: false,
        }),
      ).toThrow(AdjustmentReasonRequiredError);
    });

    it('rejects a negative corrected amount', () => {
      const original = buildDraftExpense();
      expect(() =>
        Expense.createAdjustment({
          original,
          reason: 'Nonsensical amount',
          currentOpenPeriodId: 'period-2',
          expenseNumber: 'EXP-ADJ-1',
          newAmountMinorUnits: -1n,
          requiresApproval: false,
        }),
      ).toThrow(InvalidAdjustmentAmountError);
    });

    it('rejects a corrected amount equal to the original — nothing to adjust', () => {
      const original = buildDraftExpense(); // amount: 50000n NGN
      expect(() =>
        Expense.createAdjustment({
          original,
          reason: 'No actual change',
          currentOpenPeriodId: 'period-2',
          expenseNumber: 'EXP-ADJ-1',
          newAmountMinorUnits: 50000n,
          requiresApproval: false,
        }),
      ).toThrow(NoOpAdjustmentError);
    });

    it('computes a POSITIVE delta as (newAmount - original) for an increase, linked to the original', () => {
      const original = buildDraftExpense(); // amount: 50000n NGN
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'Under-recorded the original cost',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 80000n,
        requiresApproval: true,
      });

      expect(adjustment.amount.minorUnits).toBe(30000n);
      expect(adjustment.toProps().parentExpenseId).toBe(original.id);
      expect(adjustment.periodId).toBe('period-2'); // lands in the CURRENT open period, not the original's
    });

    it('computes a NEGATIVE delta as (newAmount - original) for a decrease', () => {
      const original = buildDraftExpense(); // amount: 50000n NGN
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'Over-recorded the original cost',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 20000n,
        requiresApproval: false,
      });

      expect(adjustment.amount.minorUnits).toBe(-30000n);
    });

    it('a full reversal (newAmount: 0) still works — the original GL-reversal behaviour, now the zero case of the general mechanism', () => {
      const original = buildDraftExpense(); // amount: 50000n NGN
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'Void entirely',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 0n,
        requiresApproval: false,
      });

      expect(adjustment.amount.minorUnits).toBe(-50000n);
    });

    it('sets status to approved when requiresApproval is false', () => {
      const original = buildDraftExpense();
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'Small correction',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 40000n,
        requiresApproval: false,
      });
      expect(adjustment.status).toBe('approved');
    });

    it('sets status to pending_approval when requiresApproval is true', () => {
      const original = buildDraftExpense();
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'Large correction requiring sign-off',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 200000n,
        requiresApproval: true,
      });
      expect(adjustment.status).toBe('pending_approval');
    });

    it('emits both ExpenseAdjustmentCreated and ExpenseSubmittedForApproval when requiresApproval is true', () => {
      const original = buildDraftExpense();
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'Needs approval',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 200000n,
        requiresApproval: true,
      });
      const eventTypes = adjustment.pullDomainEvents().map((e) => e.type);
      expect(eventTypes).toEqual(['ExpenseAdjustmentCreated', 'ExpenseSubmittedForApproval']);
    });

    it('emits only ExpenseAdjustmentCreated when requiresApproval is false', () => {
      const original = buildDraftExpense();
      const adjustment = Expense.createAdjustment({
        original,
        reason: 'No approval needed',
        currentOpenPeriodId: 'period-2',
        expenseNumber: 'EXP-ADJ-1',
        newAmountMinorUnits: 20000n,
        requiresApproval: false,
      });
      const eventTypes = adjustment.pullDomainEvents().map((e) => e.type);
      expect(eventTypes).toEqual(['ExpenseAdjustmentCreated']);
    });
  });
});
