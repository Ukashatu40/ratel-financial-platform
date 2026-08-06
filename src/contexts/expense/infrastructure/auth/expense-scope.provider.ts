// src/contexts/expense/infrastructure/auth/expense-scope.provider.ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  ResourceScopeInfo,
  ResourceScopeProvider,
} from '../../../../shared-kernel/auth/resource-scope-provider.port';
import { ResourceScopeRegistry } from '../../../../shared-kernel/auth/resource-scope-registry';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';

@Injectable()
export class ExpenseScopeProvider implements ResourceScopeProvider, OnModuleInit {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository,
    private readonly registry: ResourceScopeRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('expense', this);
  }

  async getScopeInfo(resourceId: string): Promise<ResourceScopeInfo | null> {
    const expense = await this.repo.findById(resourceId);
    if (!expense) return null;
    const props = expense.toProps();
    return { departmentId: props.departmentId, requesterId: props.source.actorId };
  }
}
