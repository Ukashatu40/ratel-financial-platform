// test/unit/reporting/expense-adjustments-summary.handler.spec.ts
import { ExpenseAdjustmentsSummaryHandler } from '../../../src/reporting/application/handlers/expense-adjustments-summary.handler';
import { ExpenseAdjustmentsSummaryQuery } from '../../../src/reporting/application/queries/expense-adjustments-summary.query';
import {
  EffectiveScope,
  EffectiveScopeResolver,
} from '../../../src/shared-kernel/auth/effective-scope-resolver.port';
import { UserPrincipal } from '../../../src/shared-kernel/auth/user-principal';
import { it, expect, describe } from '@jest/globals';

function buildUser(overrides: Partial<UserPrincipal> = {}): UserPrincipal {
  return {
    id: 'user-1',
    email: 'u@test.local',
    organizationId: 'org-1',
    roles: [{ role: 'finance_director', departmentId: null }],
    ...overrides,
  };
}
class FakeScopeResolver implements EffectiveScopeResolver {
  constructor(private readonly scope: EffectiveScope) {}
  async resolveWidestScope() {
    return this.scope;
  }
}
function buildFakePrisma(groupByResult: any[] = []) {
  return { expenseReadModel: { groupBy: jest.fn().mockResolvedValue(groupByResult) } };
}

describe('ExpenseAdjustmentsSummaryHandler', () => {
  it('returns empty array (fail closed) when scope resolves to null', async () => {
    const prisma = buildFakePrisma();
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver(null),
    );

    const result = await handler.execute(
      new ExpenseAdjustmentsSummaryQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(result).toEqual([]);
    expect(prisma.expenseReadModel.groupBy).not.toHaveBeenCalled();
  });

  it('filters by departmentId for "department" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver('department'),
    );
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });

    await handler.execute(
      new ExpenseAdjustmentsSummaryQuery(user, new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toEqual({
      in: ['dept-A'],
    });
  });

  it('applies NO departmentId filter for "organization" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    await handler.execute(
      new ExpenseAdjustmentsSummaryQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toBeUndefined();
  });

  it('filters to approved adjustments only (parentExpenseId not null) within the date range', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    await handler.execute(new ExpenseAdjustmentsSummaryQuery(buildUser(), from, to));

    const where = prisma.expenseReadModel.groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('approved');
    expect(where.parentExpenseId).toEqual({ not: null });
    expect(where.expenseDate).toEqual({ gte: from, lte: to });
  });

  it('nets a signed sum to string — a correction and its reversal net to zero', async () => {
    // +50000 correction, -50000 reversal in the same group — the DB's SUM
    // already does this; asserting the handler passes it through unmodified.
    const prisma = buildFakePrisma([
      {
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        _sum: { amountMinorUnits: 0n },
        _count: { expenseId: 2 },
      },
    ]);
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ExpenseAdjustmentsSummaryQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    // The entire reason adjustmentCount exists: net zero must NOT read as
    // "nothing happened" when 2 adjustments actually occurred.
    expect(result).toEqual([
      {
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        netMinorUnits: '0',
        adjustmentCount: 2,
      },
    ]);
  });

  it('preserves a negative net (more reversed than added) as a signed string', async () => {
    const prisma = buildFakePrisma([
      {
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        _sum: { amountMinorUnits: -25000n },
        _count: { expenseId: 1 },
      },
    ]);
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ExpenseAdjustmentsSummaryQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(result[0].netMinorUnits).toBe('-25000');
  });

  it('handles a null _sum (no matching rows) as zero', async () => {
    const prisma = buildFakePrisma([
      {
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        _sum: { amountMinorUnits: null },
        _count: { expenseId: 0 },
      },
    ]);
    const handler = new ExpenseAdjustmentsSummaryHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ExpenseAdjustmentsSummaryQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(result[0].netMinorUnits).toBe('0');
  });
});
