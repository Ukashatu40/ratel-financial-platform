// test/unit/reporting/top-vendors.handler.spec.ts
import { TopVendorsHandler } from '../../../src/reporting/application/handlers/top-vendors.handler';
import { TopVendorsQuery } from '../../../src/reporting/application/queries/top-vendors.query';
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

describe('TopVendorsHandler', () => {
  it('always excludes rows with a null vendorId in the query', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new TopVendorsHandler(prisma as any, new FakeScopeResolver('organization'));
    await handler.execute(
      new TopVendorsQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );
    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.vendorId).toEqual({ not: null });
  });

  it('defensively filters out any null-vendorId rows even if the DB somehow returns one', async () => {
    const prisma = buildFakePrisma([
      {
        vendorId: null,
        vendorName: null,
        _sum: { amountMinorUnits: 5000n },
        _count: { expenseId: 1 },
      },
      {
        vendorId: 'v-1',
        vendorName: 'AWS',
        _sum: { amountMinorUnits: 10000n },
        _count: { expenseId: 1 },
      },
    ]);
    const handler = new TopVendorsHandler(prisma as any, new FakeScopeResolver('organization'));
    const result = await handler.execute(
      new TopVendorsQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );
    expect(result).toHaveLength(1);
    expect(result[0].vendorId).toBe('v-1');
  });

  it('returns empty array when scope is null', async () => {
    const prisma = buildFakePrisma();
    const handler = new TopVendorsHandler(prisma as any, new FakeScopeResolver(null));
    const result = await handler.execute(
      new TopVendorsQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );
    expect(result).toEqual([]);
  });
});
