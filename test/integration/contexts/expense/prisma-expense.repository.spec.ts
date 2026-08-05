// test/integration/contexts/expense/prisma-expense.repository.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../../setup/db-helper';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { PrismaExpenseRepository } from '../../../../src/contexts/expense/infrastructure/persistence/prisma-expense.repository';
import { Expense } from '../../../../src/contexts/expense/domain/aggregates/expense.aggregate';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { humanSource } from '../../../../src/contexts/expense/domain/value-objects/expense-source';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('PrismaExpenseRepository (integration)', () => {
  let prisma: PrismaClient;
  let repo: PrismaExpenseRepository;
  let orgId: string;
  let deptId: string;
  let categoryId: string;
  let periodId: string;

  beforeAll(async () => {
    prisma = getTestPrismaClient();

    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: PrismaService, useValue: prisma }, PrismaExpenseRepository],
    }).compile();

    repo = moduleRef.get(PrismaExpenseRepository);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    const org = await prisma.organization.create({ data: { name: 'Test Org' } });
    orgId = org.id;

    const dept = await prisma.department.create({
      data: { organizationId: orgId, name: 'Engineering' },
    });
    deptId = dept.id;

    const category = await prisma.expenseCategory.create({
      data: { organizationId: orgId, name: 'Cloud' },
    });
    categoryId = category.id;

    const period = await prisma.financialPeriod.create({
      data: {
        organizationId: orgId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });
    periodId = period.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildExpense(overrides: Partial<{ expenseNumber: string; amount: bigint }> = {}) {
    return Expense.create({
      organizationId: orgId,
      expenseNumber: overrides.expenseNumber ?? 'EXP-000001',
      source: humanSource('employee', 'user-1'),
      amount: Money.of(overrides.amount ?? 50000n, 'NGN'),
      categoryId,
      departmentId: deptId,
      periodId,
      expenseDate: new Date('2026-08-15'),
    });
  }

  it('persists and reconstructs an expense with Money round-tripped correctly', async () => {
    const expense = buildExpense({ amount: 123456n });
    await prisma.$transaction((tx) => repo.save(expense, tx));

    const found = await repo.findById(expense.id);
    expect(found).not.toBeNull();
    expect(found!.amount.minorUnits).toBe(123456n);
    expect(found!.amount.currencyCode).toBe('NGN');
    expect(found!.status).toBe('draft');
  });

  it('persists a state transition (submit -> approve) correctly', async () => {
    const expense = buildExpense();
    await prisma.$transaction((tx) => repo.save(expense, tx));

    expense.submitForApproval();
    await prisma.$transaction((tx) => repo.save(expense, tx));

    let found = await repo.findById(expense.id);
    expect(found!.status).toBe('pending_approval');

    expense.approve('approver-1');
    await prisma.$transaction((tx) => repo.save(expense, tx));

    found = await repo.findById(expense.id);
    expect(found!.status).toBe('approved');
  });

  it('persists an adjustment with correct parentExpenseId linkage', async () => {
    const original = buildExpense({ expenseNumber: 'EXP-000001', amount: 50000n });
    await prisma.$transaction((tx) => repo.save(original, tx));

    const adjustment = Expense.createAdjustment({
      original,
      reason: 'Duplicate correction',
      currentOpenPeriodId: periodId,
      expenseNumber: 'EXP-000002',
      requiresApproval: false,
    });
    await prisma.$transaction((tx) => repo.save(adjustment, tx));

    const found = await repo.findById(adjustment.id);
    expect(found!.toProps().parentExpenseId).toBe(original.id);
    expect(found!.amount.minorUnits).toBe(-50000n);
  });

  describe('nextExpenseNumber() — atomicity under concurrency', () => {
    it('produces sequential, unique numbers under concurrent calls', async () => {
      // Fires 10 concurrent calls within separate transactions, simulating
      // simultaneous expense creation — this is the actual test of whether
      // the upsert-based increment (Phase 4/piece 4's implementation) holds
      // under real concurrent load against real Postgres, not just in
      // sequential unit-test calls.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          prisma.$transaction((tx) => repo.nextExpenseNumber(orgId, tx)),
        ),
      );

      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(10); // no two concurrent calls got the same number
    });

    it('continues incrementing correctly on subsequent calls after concurrent use', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          prisma.$transaction((tx) => repo.nextExpenseNumber(orgId, tx)),
        ),
      );

      const next = await prisma.$transaction((tx) => repo.nextExpenseNumber(orgId, tx));
      expect(next).toBe('EXP-000006');
    });
  });
});
