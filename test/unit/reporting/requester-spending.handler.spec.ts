// test/unit/reporting/requester-spending.handler.spec.ts
import { RequesterSpendingHandler } from '../../../src/reporting/application/handlers/requester-spending.handler';
import { RequesterSpendingQuery } from '../../../src/reporting/application/queries/requester-spending.query';
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
function buildFakePrisma(groupByResult: any[] = [], users: any[] = [], employees: any[] = []) {
  return {
    expenseReadModel: { groupBy: jest.fn().mockResolvedValue(groupByResult) },
    user: { findMany: jest.fn().mockResolvedValue(users) },
    employee: { findMany: jest.fn().mockResolvedValue(employees) },
  };
}

describe('RequesterSpendingHandler', () => {
  it('returns empty array (fail closed) when scope resolves to null, without any lookups', async () => {
    const prisma = buildFakePrisma();
    const handler = new RequesterSpendingHandler(prisma as any, new FakeScopeResolver(null));

    const result = await handler.execute(
      new RequesterSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result).toEqual([]);
    expect(prisma.expenseReadModel.groupBy).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('filters by departmentId for "department" scope', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new RequesterSpendingHandler(
      prisma as any,
      new FakeScopeResolver('department'),
    );
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });

    await handler.execute(
      new RequesterSpendingQuery(user, new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.expenseReadModel.groupBy.mock.calls[0][0].where.departmentId).toEqual({
      in: ['dept-A'],
    });
  });

  it('skips the User/Employee lookups entirely when the grouped result is empty', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new RequesterSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    await handler.execute(
      new RequesterSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('resolves requesterName to the linked Employee.fullName when a link exists', async () => {
    const prisma = buildFakePrisma(
      [
        {
          sourceActorId: 'user-abc',
          _sum: { amountMinorUnits: 100000n },
          _count: { expenseId: 1 },
        },
      ],
      [{ id: 'user-abc', email: 'abc@example.com' }],
      [{ userId: 'user-abc', fullName: 'Amaka Okoro' }],
    );
    const handler = new RequesterSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new RequesterSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].requesterName).toBe('Amaka Okoro');
  });

  it('falls back to User.email when no Employee link exists', async () => {
    const prisma = buildFakePrisma(
      [
        {
          sourceActorId: 'user-xyz',
          _sum: { amountMinorUnits: 50000n },
          _count: { expenseId: 1 },
        },
      ],
      [{ id: 'user-xyz', email: 'xyz@example.com' }],
      [], // no Employee row links to this user
    );
    const handler = new RequesterSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new RequesterSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].requesterName).toBe('xyz@example.com');
  });

  it('falls back to "Unknown" when neither an Employee link nor a User row resolves', async () => {
    const prisma = buildFakePrisma(
      [
        {
          sourceActorId: 'ghost-actor',
          _sum: { amountMinorUnits: 10000n },
          _count: { expenseId: 1 },
        },
      ],
      [],
      [],
    );
    const handler = new RequesterSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new RequesterSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].requesterName).toBe('Unknown');
  });

  it('converts BigInt sums to strings, and handles a null _sum as zero', async () => {
    const prisma = buildFakePrisma(
      [{ sourceActorId: 'user-abc', _sum: { amountMinorUnits: null }, _count: { expenseId: 0 } }],
      [{ id: 'user-abc', email: 'abc@example.com' }],
      [],
    );
    const handler = new RequesterSpendingHandler(
      prisma as any,
      new FakeScopeResolver('organization'),
    );

    const result = await handler.execute(
      new RequesterSpendingQuery(buildUser(), new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].totalMinorUnits).toBe('0');
  });
});
