// src/reporting/application/handlers/pending-department-spending.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { Prisma } from '@prisma/client';
import { PendingDepartmentSpendingQuery } from '../queries/pending-department-spending.query';

export interface PendingDepartmentSpendingRow {
  departmentId: string;
  departmentName: string;
  totalMinorUnits: string;
  expenseCount: number;
}

/**
 * Every other report in this module deliberately filters to status:
 * 'approved' only (confirmed by department-spending-summary.handler.spec.ts's
 * — presumed, matching the e2e control — draft-expenses-excluded case). This
 * is the one exception: pending_approval only, by design, so it answers a
 * genuinely different question ("what's committed but not yet approved")
 * rather than a variant of "what's been spent". Deliberately NOT including
 * 'draft' — an unsubmitted expense could still be abandoned or heavily
 * edited, so counting it would overstate real exposure.
 */
@Injectable()
export class PendingDepartmentSpendingHandler implements QueryHandler<
  PendingDepartmentSpendingQuery,
  PendingDepartmentSpendingRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: PendingDepartmentSpendingQuery): Promise<PendingDepartmentSpendingRow[]> {
    const user = query.requestingUser;
    const scope = await this.scopeResolver.resolveWidestScope(
      user.roles.map((r) => r.role),
      'report:view',
    );
    if (scope === null) return [];

    const where: Prisma.ExpenseReadModelWhereInput = {
      organizationId: user.organizationId,
      status: 'pending_approval',
      expenseDate: { gte: query.from, lte: query.to },
    };
    if (scope === 'department') {
      where.departmentId = {
        in: user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!),
      };
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
