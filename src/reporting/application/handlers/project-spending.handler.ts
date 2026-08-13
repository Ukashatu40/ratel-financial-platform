// src/reporting/application/handlers/project-spending.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { ProjectSpendingQuery } from '../queries/project-spending.query';

export interface ProjectSpendingRow {
  projectId: string;
  projectName: string;
  totalMinorUnits: string;
  expenseCount: number;
}

@Injectable()
export class ProjectSpendingHandler implements QueryHandler<
  ProjectSpendingQuery,
  ProjectSpendingRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: ProjectSpendingQuery): Promise<ProjectSpendingRow[]> {
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
      projectId: { not: null },
    };
    if (scope === 'department') {
      where.departmentId = {
        in: user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!),
      };
    }

    const grouped = await this.prisma.expenseReadModel.groupBy({
      by: ['projectId', 'projectName'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { expenseId: true },
      orderBy: { _sum: { amountMinorUnits: 'desc' } },
    });

    return grouped
      .filter((g) => g.projectId !== null)
      .map((g) => ({
        projectId: g.projectId!,
        projectName: g.projectName ?? 'Unknown',
        totalMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
        expenseCount: g._count.expenseId,
      }));
  }
}
