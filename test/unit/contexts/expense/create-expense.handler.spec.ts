// test/unit/contexts/expense/create-expense.handler.spec.ts
import { CreateExpenseHandler } from '../../../../src/contexts/expense/application/handlers/create-expense.handler';
import { CreateExpenseCommand } from '../../../../src/contexts/expense/application/commands/create-expense.command';
import {
  InactiveOrMissingReferenceDataError,
  NoOpenPeriodError,
} from '../../../../src/shared-kernel/errors/domain-error';
import { humanSource } from '../../../../src/contexts/expense/domain/value-objects/expense-source';
import { describe, expect, it } from '@jest/globals';

function buildDeps(
  overrides: {
    department?: any;
    category?: any;
    vendor?: any;
    project?: any;
    openPeriod?: any;
  } = {},
) {
  const prisma = {
    department: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'department' in overrides ? overrides.department : { id: 'dept-1', isActive: true },
        ),
    },
    expenseCategory: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'category' in overrides ? overrides.category : { id: 'cat-1', isActive: true },
        ),
    },
    vendor: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'vendor' in overrides ? overrides.vendor : { id: 'vendor-1', isActive: true },
        ),
    },
    project: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'project' in overrides ? overrides.project : { id: 'proj-1', isActive: true },
        ),
    },
  };
  const repo = { nextExpenseNumber: jest.fn().mockResolvedValue('EXP-000001'), save: jest.fn() };
  const periodStatus = {
    currentOpenPeriod: jest
      .fn()
      .mockResolvedValue('openPeriod' in overrides ? overrides.openPeriod : { id: 'period-1' }),
  };
  const uow = { transaction: jest.fn((fn) => fn({})) };
  const outbox = { enqueue: jest.fn() };
  return { prisma, repo, periodStatus, uow, outbox };
}

function buildCommand(overrides: { vendorId?: string; projectId?: string } = {}) {
  return new CreateExpenseCommand(
    'org-1',
    humanSource('employee', 'user-1'),
    50000n,
    'NGN',
    'cat-1',
    'dept-1',
    new Date('2026-08-01'),
    'vendorId' in overrides ? overrides.vendorId : 'vendor-1',
    'projectId' in overrides ? overrides.projectId : 'proj-1',
  );
}

describe('CreateExpenseHandler', () => {
  it('rejects when no financial period is open', async () => {
    const deps = buildDeps({ openPeriod: null });
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    await expect(handler.execute(buildCommand())).rejects.toThrow(NoOpenPeriodError);
  });

  it('rejects when the department does not exist or is inactive', async () => {
    const deps = buildDeps({ department: null });
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    await expect(handler.execute(buildCommand())).rejects.toThrow(
      InactiveOrMissingReferenceDataError,
    );
    expect(deps.repo.save).not.toHaveBeenCalled(); // never reaches the transaction
  });

  it('rejects when the category does not exist or is inactive', async () => {
    const deps = buildDeps({ category: null });
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    await expect(handler.execute(buildCommand())).rejects.toThrow(
      InactiveOrMissingReferenceDataError,
    );
  });

  it('rejects when a PROVIDED vendorId does not exist or is inactive', async () => {
    const deps = buildDeps({ vendor: null });
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    await expect(handler.execute(buildCommand())).rejects.toThrow(
      InactiveOrMissingReferenceDataError,
    );
  });

  it('does NOT check vendor at all when vendorId is omitted (optional field)', async () => {
    const deps = buildDeps();
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    await handler.execute(buildCommand({ vendorId: undefined }));

    expect(deps.prisma.vendor.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when a PROVIDED projectId does not exist or is inactive', async () => {
    const deps = buildDeps({ project: null });
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    await expect(handler.execute(buildCommand())).rejects.toThrow(
      InactiveOrMissingReferenceDataError,
    );
  });

  it('succeeds when department, category, vendor, and project are all active', async () => {
    const deps = buildDeps();
    const handler = new CreateExpenseHandler(
      deps.repo as any,
      deps.periodStatus as any,
      deps.uow as any,
      deps.outbox as any,
      deps.prisma as any,
    );

    const result = await handler.execute(buildCommand());

    expect(result.expenseNumber).toBe('EXP-000001');
    expect(deps.repo.save).toHaveBeenCalled();
  });
});
