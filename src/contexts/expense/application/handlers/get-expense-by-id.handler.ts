// src/contexts/expense/application/handlers/get-expense-by-id.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { ExpenseProps } from '../../domain/aggregates/expense.aggregate';
import { GetExpenseByIdQuery } from '../queries/get-expense-by-id.query';

/**
 * No scope re-checking here — PermissionGuard already resolved and
 * enforced resource-level access (via ResourceScopeRegistry) BEFORE this
 * handler ever runs, for the :id endpoint. This handler trusts that.
 */
@Injectable()
export class GetExpenseByIdHandler implements QueryHandler<GetExpenseByIdQuery, ExpenseProps> {
  constructor(@Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository) {}

  async execute(query: GetExpenseByIdQuery): Promise<ExpenseProps> {
    const expense = await this.repo.findById(query.expenseId);
    if (!expense || expense.organizationId !== query.organizationId) {
      throw new EntityNotFoundError('Expense', query.expenseId);
    }
    return expense.toProps();
  }
}
