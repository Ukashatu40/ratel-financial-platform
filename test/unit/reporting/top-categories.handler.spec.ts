// test/unit/reporting/top-categories.handler.spec.ts
import { TopCategoriesHandler } from '../../../src/reporting/application/handlers/top-categories.handler';
import { TopCategoriesQuery } from '../../../src/reporting/application/queries/top-categories.query';
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
    roles: [{ role: 'accountant', departmentId: null }],
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

describe('TopCategoriesHandler', () => {
  it('returns empty array when scope is null', async () => {
    const prisma = buildFakePrisma();
    const handler = new TopCategoriesHandler(prisma as any, new FakeScopeResolver(null));
    const result = await handler.execute(
      new TopCategoriesQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );
    expect(result).toEqual([]);
  });

  it('passes the limit through as `take`', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new TopCategoriesHandler(prisma as any, new FakeScopeResolver('organization'));
    await handler.execute(
      new TopCategoriesQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31'), 3),
    );
    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].take).toBe(3);
  });

  it('orders by summed amount descending', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new TopCategoriesHandler(prisma as any, new FakeScopeResolver('organization'));
    await handler.execute(
      new TopCategoriesQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );
    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].orderBy).toEqual({
      _sum: { amountMinorUnits: 'desc' },
    });
  });

  it('scopes to department when caller is department-scoped', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new TopCategoriesHandler(prisma as any, new FakeScopeResolver('department'));
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });
    await handler.execute(
      new TopCategoriesQuery(user, new Date('2026-08-01'), new Date('2026-08-31')),
    );
    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toEqual({
      in: ['dept-A'],
    });
  });
});
