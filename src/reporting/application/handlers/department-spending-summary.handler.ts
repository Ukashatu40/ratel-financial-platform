// src/reporting/application/handlers/department-spending-summary.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { Prisma } from '@prisma/client';
import { DepartmentSpendingSummaryQuery } from '../queries/department-spending-summary.query';

export interface DepartmentSpendingRow {
  departmentId: string;
  departmentName: string;
  totalMinorUnits: string; // stringified — BigInt isn't JSON-serializable directly
  expenseCount: number;
}

@Injectable()
export class DepartmentSpendingSummaryHandler implements QueryHandler<
  DepartmentSpendingSummaryQuery,
  DepartmentSpendingRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: DepartmentSpendingSummaryQuery): Promise<DepartmentSpendingRow[]> {
    const user = query.requestingUser;
    const roles = user.roles.map((r) => r.role);
    const scope = await this.scopeResolver.resolveWidestScope(roles, 'report:view');
    if (scope === null) return []; // fail closed — same pattern as ListExpensesHandler

    const where: Prisma.ExpenseReadModelWhereInput = {
      organizationId: user.organizationId,
      status: 'approved',
      expenseDate: { gte: query.from, lte: query.to },
    };
    if (scope === 'department') {
      const departmentIds = user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!);
      where.departmentId = { in: departmentIds };
    }

    const grouped = await this.prisma.expenseReadModel.groupBy({
      by: ['departmentId', 'departmentName'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { expenseId: true },
      orderBy: { _sum: { amountMinorUnits: 'desc' } },
    });

    return grouped.map((g) => ({
      departmentId: g.departmentId,
      departmentName: g.departmentName,
      totalMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
      expenseCount: g._count.expenseId,
    }));
  }
}
