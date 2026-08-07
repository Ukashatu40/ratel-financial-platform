// test/unit/reporting/expense-read-model.projector.spec.ts
import { ExpenseReadModelProjector } from '../../../src/reporting/infrastructure/projectors/expense-read-model.projector';
import { DomainEventDispatcher } from '../../../src/shared-kernel/events/domain-event-dispatcher';
import { DomainEvent } from '../../../src/shared-kernel/events/domain-event';
import { it, expect, describe } from '@jest/globals';

function buildFakePrisma() {
  return {
    expense: { findFirst: jest.fn() },
    department: { findUnique: jest.fn() },
    expenseCategory: { findUnique: jest.fn() },
    vendor: { findUnique: jest.fn() },
    expenseReadModel: { upsert: jest.fn() },
  };
}

describe('ExpenseReadModelProjector', () => {
  it('registers itself for every relevant Expense event type on module init', () => {
    const dispatcher = new DomainEventDispatcher();
    const registerSpy = jest.spyOn(dispatcher, 'register');
    const projector = new ExpenseReadModelProjector(dispatcher, buildFakePrisma() as any);

    projector.onModuleInit();

    const registeredTypes = registerSpy.mock.calls.map((call: any) => call[0]);
    expect(registeredTypes).toEqual(
      expect.arrayContaining([
        'ExpenseDrafted',
        'ExpenseSubmittedForApproval',
        'ExpenseApproved',
        'ExpenseRejected',
        'ExpenseCancelled',
        'ExpenseAdjustmentCreated',
      ]),
    );
  });

  it('upserts a read model row with joined department/category/vendor names', async () => {
    const prisma = buildFakePrisma();
    prisma.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      organizationId: 'org-1',
      departmentId: 'dept-1',
      categoryId: 'cat-1',
      vendorId: 'vendor-1',
      projectId: null,
      amountMinorUnits: 50000n,
      currency: 'NGN',
      status: 'approved',
      expenseDate: new Date('2026-08-15'),
      parentExpenseId: null,
      createdAt: new Date('2026-08-15T10:00:00Z'),
      updatedAt: new Date('2026-08-15T10:05:00Z'),
    });
    prisma.department.findUnique.mockResolvedValue({ name: 'Engineering' });
    prisma.expenseCategory.findUnique.mockResolvedValue({ name: 'Cloud Services' });
    prisma.vendor.findUnique.mockResolvedValue({ name: 'AWS' });

    const dispatcher = new DomainEventDispatcher();
    const projector = new ExpenseReadModelProjector(dispatcher, prisma as any);
    projector.onModuleInit();

    const event: DomainEvent = {
      type: 'ExpenseApproved',
      aggregateType: 'Expense',
      aggregateId: 'exp-1',
      occurredAt: new Date(),
      payload: {},
    };
    await dispatcher.dispatch(event);

    expect(prisma.expenseReadModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expenseId: 'exp-1' },
        create: expect.objectContaining({
          departmentName: 'Engineering',
          categoryName: 'Cloud Services',
          vendorName: 'AWS',
          amountMinorUnits: 50000n,
          status: 'approved',
        }),
      }),
    );
  });

  it('falls back to "Unknown" names when department/category lookups return null', async () => {
    const prisma = buildFakePrisma();
    prisma.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      organizationId: 'org-1',
      departmentId: 'gone',
      categoryId: 'gone',
      vendorId: null,
      projectId: null,
      amountMinorUnits: 1000n,
      currency: 'NGN',
      status: 'draft',
      expenseDate: new Date(),
      parentExpenseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.department.findUnique.mockResolvedValue(null);
    prisma.expenseCategory.findUnique.mockResolvedValue(null);

    const dispatcher = new DomainEventDispatcher();
    const projector = new ExpenseReadModelProjector(dispatcher, prisma as any);
    projector.onModuleInit();

    await dispatcher.dispatch({
      type: 'ExpenseDrafted',
      aggregateType: 'Expense',
      aggregateId: 'exp-1',
      occurredAt: new Date(),
      payload: {},
    });

    expect(prisma.expenseReadModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          departmentName: 'Unknown',
          categoryName: 'Unknown',
          vendorName: null,
        }),
      }),
    );
  });

  it('skips projection without throwing when the source expense no longer exists', async () => {
    const prisma = buildFakePrisma();
    prisma.expense.findFirst.mockResolvedValue(null);

    const dispatcher = new DomainEventDispatcher();
    const projector = new ExpenseReadModelProjector(dispatcher, prisma as any);
    projector.onModuleInit();

    await expect(
      dispatcher.dispatch({
        type: 'ExpenseDrafted',
        aggregateType: 'Expense',
        aggregateId: 'missing',
        occurredAt: new Date(),
        payload: {},
      }),
    ).resolves.not.toThrow();
    expect(prisma.expenseReadModel.upsert).not.toHaveBeenCalled();
  });

  it('does NOT react to unrelated event types (e.g. PayrollRunCreated)', async () => {
    const prisma = buildFakePrisma();
    const dispatcher = new DomainEventDispatcher();
    const projector = new ExpenseReadModelProjector(dispatcher, prisma as any);
    projector.onModuleInit();

    await dispatcher.dispatch({
      type: 'PayrollRunCreated',
      aggregateType: 'PayrollRun',
      aggregateId: 'run-1',
      occurredAt: new Date(),
      payload: {},
    });

    expect(prisma.expense.findFirst).not.toHaveBeenCalled();
  });
});
