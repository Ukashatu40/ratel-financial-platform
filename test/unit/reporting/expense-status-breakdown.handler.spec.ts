// test/unit/reporting/expense-status-breakdown.handler.spec.ts
import { ExpenseStatusBreakdownHandler } from '../../../src/reporting/application/handlers/expense-status-breakdown.handler';
import { ExpenseStatusBreakdownQuery } from '../../../src/reporting/application/queries/expense-status-breakdown.query';
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

describe('ExpenseStatusBreakdownHandler', () => {
  it('returns empty array (fail closed) when scope resolves to null', async () => {
    const prisma = buildFakePrisma();
    const handler = new ExpenseStatusBreakdownHandler(prisma as any, new FakeScopeResolver(null));

    const result = await handler.execute(
      new ExpenseStatusBreakdownQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result).toEqual([]);
    expect(prisma.expenseReadModel.groupBy).not.toHaveBeenCalled();
  });

  it('filters by departmentId for "department" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ExpenseStatusBreakdownHandler(
      prisma as any,
      new FakeScopeResolver('department'),
    );
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });

    await handler.execute(
      new ExpenseStatusBreakdownQuery(user, new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toEqual({
      in: ['dept-A'],
    });
  });

  it('applies NO departmentId filter for "organization" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ExpenseStatusBreakdownHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    await handler.execute(
      new ExpenseStatusBreakdownQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toBeUndefined();
  });

  it('applies NO status filter at all — this is the whole funnel, not one status', async () => {
    // The distinguishing behavior of this handler versus every sibling report:
    // no other handler in this module omits a status filter entirely.
    const prisma = buildFakePrisma([]);
    const handler = new ExpenseStatusBreakdownHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    await handler.execute(new ExpenseStatusBreakdownQuery(buildUser(), from, to));

    const where = prisma.expenseReadModel.groupBy.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
    expect(where.expenseDate).toEqual({ gte: from, lte: to });
  });

  it('sorts results into canonical funnel order, regardless of the order Postgres returns them', async () => {
    const prisma = buildFakePrisma([
      { status: 'closed', _sum: { amountMinorUnits: 1000n }, _count: { expenseId: 1 } },
      { status: 'draft', _sum: { amountMinorUnits: 2000n }, _count: { expenseId: 2 } },
      { status: 'approved', _sum: { amountMinorUnits: 3000n }, _count: { expenseId: 3 } },
      { status: 'pending_approval', _sum: { amountMinorUnits: 4000n }, _count: { expenseId: 4 } },
    ]);
    const handler = new ExpenseStatusBreakdownHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ExpenseStatusBreakdownQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result.map((r) => r.status)).toEqual([
      'draft',
      'pending_approval',
      'approved',
      'closed',
    ]);
  });

  it('converts BigInt sums to strings in the response', async () => {
    const prisma = buildFakePrisma([
      { status: 'approved', _sum: { amountMinorUnits: 1750000n }, _count: { expenseId: 2 } },
    ]);
    const handler = new ExpenseStatusBreakdownHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ExpenseStatusBreakdownQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result).toEqual([{ status: 'approved', totalMinorUnits: '1750000', expenseCount: 2 }]);
  });

  it('handles a null _sum (no matching rows) as zero', async () => {
    const prisma = buildFakePrisma([
      { status: 'draft', _sum: { amountMinorUnits: null }, _count: { expenseId: 0 } },
    ]);
    const handler = new ExpenseStatusBreakdownHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ExpenseStatusBreakdownQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].totalMinorUnits).toBe('0');
  });
});
