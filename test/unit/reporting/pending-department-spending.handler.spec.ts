// test/unit/reporting/pending-department-spending.handler.spec.ts
import { PendingDepartmentSpendingHandler } from '../../../src/reporting/application/handlers/pending-department-spending.handler';
import { PendingDepartmentSpendingQuery } from '../../../src/reporting/application/queries/pending-department-spending.query';
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

describe('PendingDepartmentSpendingHandler', () => {
  it('returns empty array (fail closed) when scope resolves to null', async () => {
    const prisma = buildFakePrisma();
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver(null),
    );

    const result = await handler.execute(
      new PendingDepartmentSpendingQuery(
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
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver('department'),
    );
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });

    await handler.execute(
      new PendingDepartmentSpendingQuery(user, new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toEqual({
      in: ['dept-A'],
    });
  });

  it('applies NO departmentId filter for "organization" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    await handler.execute(
      new PendingDepartmentSpendingQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toBeUndefined();
  });

  it('filters status: pending_approval (NOT approved) and the given date range', async () => {
    // The one line that distinguishes this handler from every other report in
    // this module — every sibling filters to 'approved'. Asserted explicitly
    // rather than just checked in passing, since getting this one value wrong
    // silently turns the handler into a duplicate of department-spending.
    const prisma = buildFakePrisma([]);
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    await handler.execute(new PendingDepartmentSpendingQuery(buildUser(), from, to));

    const where = prisma.expenseReadModel.groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('pending_approval');
    expect(where.expenseDate).toEqual({ gte: from, lte: to });
  });

  it('never queries status "approved" or "draft" — the query is exactly one status value', async () => {
    // Belt-and-suspenders on the assertion above: proves the where clause
    // wasn't accidentally built as an `in: [...]` that happens to include
    // pending_approval alongside something else.
    const prisma = buildFakePrisma([]);
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    await handler.execute(
      new PendingDepartmentSpendingQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    const where = prisma.expenseReadModel.groupBy.mock.calls[0][0].where;
    expect(where.status).not.toBe('approved');
    expect(where.status).not.toEqual(expect.objectContaining({ in: expect.anything() }));
  });

  it('converts BigInt sums to strings in the response', async () => {
    const prisma = buildFakePrisma([
      {
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        _sum: { amountMinorUnits: 1750000n },
        _count: { expenseId: 2 },
      },
    ]);
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new PendingDepartmentSpendingQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(result).toEqual([
      {
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        totalMinorUnits: '1750000',
        expenseCount: 2,
      },
    ]);
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
    const handler = new PendingDepartmentSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new PendingDepartmentSpendingQuery(
        buildUser(),
        new Date('2026-08-01'),
        new Date('2026-08-31'),
      ),
    );

    expect(result[0].totalMinorUnits).toBe('0');
  });
});
