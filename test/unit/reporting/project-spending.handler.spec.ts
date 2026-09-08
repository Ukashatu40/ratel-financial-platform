// test/unit/reporting/project-spending.handler.spec.ts
import { ProjectSpendingHandler } from '../../../src/reporting/application/handlers/project-spending.handler';
import { ProjectSpendingQuery } from '../../../src/reporting/application/queries/project-spending.query';
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

describe('ProjectSpendingHandler', () => {
  it('returns empty array (fail closed) when scope resolves to null', async () => {
    const prisma = buildFakePrisma();
    const handler = new ProjectSpendingHandler(prisma as any, new FakeScopeResolver(null));

    const result = await handler.execute(
      new ProjectSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result).toEqual([]);
    expect(prisma.expenseReadModel.groupBy).not.toHaveBeenCalled();
  });

  it('filters by departmentId for "department" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ProjectSpendingHandler(prisma as any, new FakeScopeResolver('department'));
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });

    await handler.execute(
      new ProjectSpendingQuery(user, new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toEqual({
      in: ['dept-A'],
    });
  });

  it('applies NO departmentId filter for "organization" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ProjectSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    await handler.execute(
      new ProjectSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toBeUndefined();
  });

  it('filters status: approved, the date range, and projectId not null', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new ProjectSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    await handler.execute(new ProjectSpendingQuery(buildUser(), from, to));

    const where = prisma.expenseReadModel.groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('approved');
    expect(where.expenseDate).toEqual({ gte: from, lte: to });
    expect(where.projectId).toEqual({ not: null });
  });

  it('filters out any row where projectId is somehow still null in the result set', async () => {
    // The where clause already excludes these at the DB level; this proves
    // the handler's own defensive .filter() is real and not dead code.
    const prisma = buildFakePrisma([
      {
        projectId: null,
        projectName: null,
        _sum: { amountMinorUnits: 5000n },
        _count: { expenseId: 1 },
      },
      {
        projectId: 'proj-1',
        projectName: 'Migration',
        _sum: { amountMinorUnits: 10000n },
        _count: { expenseId: 1 },
      },
    ]);
    const handler = new ProjectSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ProjectSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe('proj-1');
  });

  it('falls back to "Unknown" for a null projectName', async () => {
    const prisma = buildFakePrisma([
      {
        projectId: 'proj-1',
        projectName: null,
        _sum: { amountMinorUnits: 10000n },
        _count: { expenseId: 1 },
      },
    ]);
    const handler = new ProjectSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ProjectSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].projectName).toBe('Unknown');
  });

  it('converts BigInt sums to strings, and handles a null _sum as zero', async () => {
    const prisma = buildFakePrisma([
      {
        projectId: 'proj-1',
        projectName: 'Migration',
        _sum: { amountMinorUnits: null },
        _count: { expenseId: 0 },
      },
    ]);
    const handler = new ProjectSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new ProjectSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].totalMinorUnits).toBe('0');
  });
});
