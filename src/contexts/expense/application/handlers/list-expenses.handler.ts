// src/contexts/expense/application/handlers/list-expenses.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../../shared-kernel/auth/effective-scope-resolver.port';
import { decodeCursor, Page } from '../../../../shared-kernel/pagination/cursor';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { ExpenseProps } from '../../domain/aggregates/expense.aggregate';
import { ListExpensesQuery } from '../queries/list-expenses.query';

@Injectable()
export class ListExpensesHandler implements QueryHandler<ListExpensesQuery, Page<ExpenseProps>> {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: ListExpensesQuery): Promise<Page<ExpenseProps>> {
    const user = query.requestingUser;
    const roles = user.roles.map((r) => r.role);
    const scope = await this.scopeResolver.resolveWidestScope(roles, 'expense:view');

    // PermissionGuard already confirmed the user holds an 'expense:view'
    // grant of SOME kind before this handler runs — scope === null here
    // would mean the guard and this resolver disagree, which shouldn't
    // happen, but returning an empty page rather than throwing is the
    // safer failure mode for a list endpoint (fail closed, not loud).
    if (scope === null) return { data: [], nextCursor: null };

    const departmentIds =
      scope === 'department'
        ? user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!)
        : undefined;
    const requesterId = scope === 'own' ? user.id : undefined;

    const page = await this.repo.findMany({
      organizationId: user.organizationId,
      departmentIds,
      requesterId,
      status: query.status,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: query.limit,
    });

    return { data: page.data.map((e) => e.toProps()), nextCursor: page.nextCursor };
  }
}
