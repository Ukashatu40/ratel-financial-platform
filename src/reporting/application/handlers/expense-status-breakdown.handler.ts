// src/reporting/application/handlers/expense-status-breakdown.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { Prisma } from '@prisma/client';
import { ExpenseStatusBreakdownQuery } from '../queries/expense-status-breakdown.query';

export interface ExpenseStatusBreakdownRow {
  status: string;
  totalMinorUnits: string;
  expenseCount: number;
}

/**
 * The one report in this module with NO status filter — every other handler
 * filters to 'approved' (or, for pending-department-spending, 'pending_approval'
 * alone). This is deliberately the whole funnel: every ExpenseStatus value that
 * exists within the date range, including 'draft'. Unlike
 * pending-department-spending — which excludes draft because it estimates real
 * financial exposure — this describes the actual current state of every expense
 * that exists, so omitting a status would make it a partial breakdown
 * masquerading as a complete one.
 *
 * Not budgeting or forecasting — purely descriptive of what's in the read model
 * today. Forecasting/budgeting tools are a separate, later piece of work.
 */
const STATUS_ORDER = ['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed'];

@Injectable()
export class ExpenseStatusBreakdownHandler implements QueryHandler<
  ExpenseStatusBreakdownQuery,
  ExpenseStatusBreakdownRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: ExpenseStatusBreakdownQuery): Promise<ExpenseStatusBreakdownRow[]> {
    const user = query.requestingUser;
    const scope = await this.scopeResolver.resolveWidestScope(
      user.roles.map((r) => r.role),
      'report:view',
    );
    if (scope === null) return [];

    const where: Prisma.ExpenseReadModelWhereInput = {
      organizationId: user.organizationId,
      expenseDate: { gte: query.from, lte: query.to },
    };
    if (scope === 'department') {
      where.departmentId = {
        in: user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!),
      };
    }

    const grouped = await this.prisma.expenseReadModel.groupBy({
      by: ['status'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { expenseId: true },
    });

    // Sorted into canonical funnel order rather than left in whatever order
    // Postgres returns — a status breakdown reads as a pipeline, and an
    // arbitrary order would obscure that.
    return grouped
      .map((g) => ({
        status: g.status,
        totalMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
        expenseCount: g._count.expenseId,
      }))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  }
}
