// src/reporting/application/handlers/cash-outflow.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { CashOutflowQuery } from '../queries/cash-outflow.query';

export interface CashOutflowRow {
  month: string; // ISO date, first-of-month
  totalMinorUnits: string;
  expenseCount: number;
}

@Injectable()
export class CashOutflowHandler implements QueryHandler<CashOutflowQuery, CashOutflowRow[]> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: CashOutflowQuery): Promise<CashOutflowRow[]> {
    const user = query.requestingUser;
    const scope = await this.scopeResolver.resolveWidestScope(
      user.roles.map((r) => r.role),
      'report:view',
    );
    if (scope === null) return [];

    const departmentIds =
      scope === 'department'
        ? user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!)
        : null;

    type RawRow = { month: Date; total: bigint; count: bigint };
    let rows: RawRow[];

    // Separate clean execution paths to prevent Prisma template nesting syntax errors
    if (departmentIds && departmentIds.length > 0) {
      rows = await this.prisma.$queryRaw<RawRow[]>`
        SELECT date_trunc('month', expense_date) AS month,
               SUM(amount_minor_units) AS total,
               COUNT(*) AS count
        FROM expense_read_model
        WHERE organization_id = ${user.organizationId}
          AND status = 'approved'
          AND expense_date BETWEEN ${query.from} AND ${query.to}
          AND department_id = ANY(${departmentIds})
        GROUP BY month
        ORDER BY month ASC
      `;
    } else {
      rows = await this.prisma.$queryRaw<RawRow[]>`
        SELECT date_trunc('month', expense_date) AS month,
               SUM(amount_minor_units) AS total,
               COUNT(*) AS count
        FROM expense_read_model
        WHERE organization_id = ${user.organizationId}
          AND status = 'approved'
          AND expense_date BETWEEN ${query.from} AND ${query.to}
        GROUP BY month
        ORDER BY month ASC
      `;
    }

    return rows.map((r) => ({
      month: r.month.toISOString().slice(0, 10),
      totalMinorUnits: r.total ? r.total.toString() : '0', // Fallback for null sums if rows can be empty
      expenseCount: Number(r.count),
    }));
  }
}
