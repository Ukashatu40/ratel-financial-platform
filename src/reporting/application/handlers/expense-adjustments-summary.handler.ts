// src/reporting/application/handlers/expense-adjustments-summary.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { Prisma } from '@prisma/client';
import { ExpenseAdjustmentsSummaryQuery } from '../queries/expense-adjustments-summary.query';

export interface ExpenseAdjustmentsSummaryRow {
  departmentId: string;
  departmentName: string;
  netMinorUnits: string; // SIGNED — reversals and increases net against each
  // other, per ExpenseReadModel.amountMinorUnits' own
  // documented design. A near-zero net does NOT mean
  // nothing happened — see adjustmentCount.
  adjustmentCount: number;
}

/**
 * Every other report either ignores adjustments entirely (they're just rows
 * that happen to have a negative or positive amountMinorUnits, netted
 * silently into the total) or excludes them via other filters. This is the
 * one report that surfaces them AS adjustments — filtered to
 * parentExpenseId: not null, which per the Expense schema is what makes a
 * row an adjustment rather than an original expense.
 *
 * netMinorUnits deliberately nets to zero when adjustments offset (e.g. a
 * +500 correction and a -500 reversal in the same department). That's
 * consistent with how every other report already treats this column
 * (ExpenseReadModel's own schema comment: "summing this column naturally
 * nets out reversals against originals, no special-casing"). adjustmentCount
 * exists specifically so a net of zero with a nonzero count is visibly
 * distinguishable from a department with no adjustment activity at all.
 */
@Injectable()
export class ExpenseAdjustmentsSummaryHandler implements QueryHandler<
  ExpenseAdjustmentsSummaryQuery,
  ExpenseAdjustmentsSummaryRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: ExpenseAdjustmentsSummaryQuery): Promise<ExpenseAdjustmentsSummaryRow[]> {
    const user = query.requestingUser;
    const scope = await this.scopeResolver.resolveWidestScope(
      user.roles.map((r) => r.role),
      'report:view',
    );
    if (scope === null) return [];

    const where: Prisma.ExpenseReadModelWhereInput = {
      organizationId: user.organizationId,
      status: 'approved',
      expenseDate: { gte: query.from, lte: query.to },
      parentExpenseId: { not: null },
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
      netMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
      adjustmentCount: g._count.expenseId,
    }));
  }
}
