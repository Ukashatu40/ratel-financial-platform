// test/unit/contexts/expense/get-expense-by-id.handler.spec.ts
import { GetExpenseByIdHandler } from '../../../../src/contexts/expense/application/handlers/get-expense-by-id.handler';
import { GetExpenseByIdQuery } from '../../../../src/contexts/expense/application/queries/get-expense-by-id.query';
import { EntityNotFoundError } from '../../../../src/shared-kernel/errors/domain-error';
import { Expense } from '../../../../src/contexts/expense/domain/aggregates/expense.aggregate';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { humanSource } from '../../../../src/contexts/expense/domain/value-objects/expense-source';
import { describe, expect, it } from '@jest/globals';

function buildExpense(organizationId = 'org-1') {
  return Expense.create({
    organizationId,
    expenseNumber: 'EXP-000001',
    source: humanSource('employee', 'user-1'),
    amount: Money.of(50000n, 'NGN'),
    categoryId: 'cat-1',
    departmentId: 'dept-1',
    periodId: 'period-1',
    expenseDate: new Date('2026-08-01'),
  });
}

describe('GetExpenseByIdHandler', () => {
  it('returns the expense props when found and organization matches', async () => {
    const expense = buildExpense('org-1');
    const fakeRepo = { findById: jest.fn().mockResolvedValue(expense) };
    const handler = new GetExpenseByIdHandler(fakeRepo as any);

    const result = await handler.execute(new GetExpenseByIdQuery(expense.id, 'org-1'));

    expect(result.id).toBe(expense.id);
    expect(result.amount.minorUnits).toBe(50000n);
  });

  it('throws EntityNotFoundError when the expense does not exist', async () => {
    const fakeRepo = { findById: jest.fn().mockResolvedValue(null) };
    const handler = new GetExpenseByIdHandler(fakeRepo as any);

    await expect(handler.execute(new GetExpenseByIdQuery('missing-id', 'org-1'))).rejects.toThrow(
      EntityNotFoundError,
    );
  });

  it('throws EntityNotFoundError when the expense belongs to a DIFFERENT organization', async () => {
    // This is the actual security-relevant case: even if somehow an ID from
    // another org was guessed/leaked, this must 404, not 200 with someone
    // else's data.
    const expense = buildExpense('org-OTHER');
    const fakeRepo = { findById: jest.fn().mockResolvedValue(expense) };
    const handler = new GetExpenseByIdHandler(fakeRepo as any);

    await expect(handler.execute(new GetExpenseByIdQuery(expense.id, 'org-1'))).rejects.toThrow(
      EntityNotFoundError,
    );
  });
});
