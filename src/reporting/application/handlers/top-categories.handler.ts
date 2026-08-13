// src/reporting/application/handlers/top-categories.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { TopCategoriesQuery } from '../queries/top-categories.query';

export interface CategorySpendingRow {
  categoryId: string;
  categoryName: string;
  totalMinorUnits: string;
  expenseCount: number;
}

@Injectable()
export class TopCategoriesHandler implements QueryHandler<
  TopCategoriesQuery,
  CategorySpendingRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: TopCategoriesQuery): Promise<CategorySpendingRow[]> {
    const user = query.requestingUser;
    const scope = await this.scopeResolver.resolveWidestScope(
      user.roles.map((r) => r.role),
      'report:view',
    );
    if (scope === null) return [];

    const where: any = {
      organizationId: user.organizationId,
      status: 'approved',
      expenseDate: { gte: query.from, lte: query.to },
    };
    if (scope === 'department') {
      where.departmentId = {
        in: user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!),
      };
    }

    const grouped = await this.prisma.expenseReadModel.groupBy({
      by: ['categoryId', 'categoryName'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { expenseId: true },
      orderBy: { _sum: { amountMinorUnits: 'desc' } },
      take: query.limit,
    });

    return grouped.map((g) => ({
      categoryId: g.categoryId,
      categoryName: g.categoryName,
      totalMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
      expenseCount: g._count.expenseId,
    }));
  }
}
