// test/unit/contexts/expense/list-expenses.handler.spec.ts
import { ListExpensesHandler } from '../../../../src/contexts/expense/application/handlers/list-expenses.handler';
import { ListExpensesQuery } from '../../../../src/contexts/expense/application/queries/list-expenses.query';
import {
  ExpenseListFilter,
  ExpenseRepository,
} from '../../../../src/contexts/expense/domain/ports/expense-repository.port';
import {
  EffectiveScope,
  EffectiveScopeResolver,
} from '../../../../src/shared-kernel/auth/effective-scope-resolver.port';
import { UserPrincipal } from '../../../../src/shared-kernel/auth/user-principal';
import { Expense } from '../../../../src/contexts/expense/domain/aggregates/expense.aggregate';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { humanSource } from '../../../../src/contexts/expense/domain/value-objects/expense-source';
import { describe, expect, it } from '@jest/globals';

function buildUser(overrides: Partial<UserPrincipal> = {}): UserPrincipal {
  return {
    id: 'user-1',
    email: 'user@test.local',
    organizationId: 'org-1',
    roles: [{ role: 'employee', departmentId: null }],
    ...overrides,
  };
}

class FakeExpenseRepository implements Pick<ExpenseRepository, 'findMany'> {
  lastFilter: ExpenseListFilter | null = null;

  async findMany(filter: ExpenseListFilter) {
    this.lastFilter = filter;
    return { data: [] as Expense[], nextCursor: null };
  }
}

class FakeScopeResolver implements EffectiveScopeResolver {
  constructor(private readonly scope: EffectiveScope) {}
  async resolveWidestScope(): Promise<EffectiveScope> {
    return this.scope;
  }
}

describe('ListExpensesHandler', () => {
  it('applies a requesterId filter for "own" scope', async () => {
    const repo = new FakeExpenseRepository();
    const handler = new ListExpensesHandler(repo as any, new FakeScopeResolver('own'));
    const user = buildUser({ id: 'employee-1' });

    await handler.execute(new ListExpensesQuery(user));

    expect(repo.lastFilter?.requesterId).toBe('employee-1');
    expect(repo.lastFilter?.departmentIds).toBeUndefined();
  });

  it('applies a departmentIds filter for "department" scope', async () => {
    const repo = new FakeExpenseRepository();
    const handler = new ListExpensesHandler(repo as any, new FakeScopeResolver('department'));
    const user = buildUser({ roles: [{ role: 'department_head', departmentId: 'dept-A' }] });

    await handler.execute(new ListExpensesQuery(user));

    expect(repo.lastFilter?.departmentIds).toEqual(['dept-A']);
    expect(repo.lastFilter?.requesterId).toBeUndefined();
  });

  it('applies NO filter for "organization" scope (sees everything in the org)', async () => {
    const repo = new FakeExpenseRepository();
    const handler = new ListExpensesHandler(repo as any, new FakeScopeResolver('organization'));
    const user = buildUser({ roles: [{ role: 'finance_director', departmentId: null }] });

    await handler.execute(new ListExpensesQuery(user));

    expect(repo.lastFilter?.requesterId).toBeUndefined();
    expect(repo.lastFilter?.departmentIds).toBeUndefined();
    expect(repo.lastFilter?.organizationId).toBe('org-1');
  });

  it('returns an empty page (fail closed) when scope resolves to null', async () => {
    const repo = new FakeExpenseRepository();
    const handler = new ListExpensesHandler(repo as any, new FakeScopeResolver(null));
    const user = buildUser();

    const result = await handler.execute(new ListExpensesQuery(user));

    expect(result).toEqual({ data: [], nextCursor: null });
  });

  it('passes status filter and cursor/limit through to the repository', async () => {
    const repo = new FakeExpenseRepository();
    const handler = new ListExpensesHandler(repo as any, new FakeScopeResolver('organization'));
    const user = buildUser({ roles: [{ role: 'finance_director', departmentId: null }] });

    await handler.execute(
      new ListExpensesQuery(user, ['approved', 'pending_approval'], undefined, 10),
    );

    expect(repo.lastFilter?.status).toEqual(['approved', 'pending_approval']);
    expect(repo.lastFilter?.limit).toBe(10);
  });
});
