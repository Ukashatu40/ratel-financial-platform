// src/reporting/application/handlers/requester-spending.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { Prisma } from '@prisma/client';
import { RequesterSpendingQuery } from '../queries/requester-spending.query';

export interface RequesterSpendingRow {
  requesterId: string;
  requesterName: string; // Employee.fullName via the linked userId if one
  // exists (#41's nullable link), else User.email,
  // else 'Unknown' if neither resolves at all.
  totalMinorUnits: string;
  expenseCount: number;
}

/**
 * The one report needing a genuine schema/projector change rather than a new
 * query against existing data — ExpenseReadModel carried no requester column
 * before this. ASSUMPTION, not verified against Expense's schema (no FK
 * declared on sourceActorId): every source_actor_id is a User.id, matching
 * every other actor field in this codebase (createdById, approvedById, etc).
 * If a non-employee, non-linked source ever exists, it resolves to
 * 'Unknown' rather than throwing.
 */
@Injectable()
export class RequesterSpendingHandler implements QueryHandler<
  RequesterSpendingQuery,
  RequesterSpendingRow[]
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: RequesterSpendingQuery): Promise<RequesterSpendingRow[]> {
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
    };
    if (scope === 'department') {
      where.departmentId = {
        in: user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!),
      };
    }

    const grouped = await this.prisma.expenseReadModel.groupBy({
      by: ['sourceActorId'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { expenseId: true },
      orderBy: { _sum: { amountMinorUnits: 'desc' } },
    });

    if (grouped.length === 0) return [];

    const actorIds = grouped.map((g) => g.sourceActorId);

    // Batched, not N+1: one query per lookup type regardless of how many
    // distinct requesters are in the result set.
    const [users, employees] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      }),
      this.prisma.employee.findMany({
        where: { userId: { in: actorIds } },
        select: { userId: true, fullName: true },
      }),
    ]);

    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const fullNameByUserId = new Map(
      employees.filter((e) => e.userId).map((e) => [e.userId as string, e.fullName]),
    );

    return grouped.map((g) => ({
      requesterId: g.sourceActorId,
      requesterName:
        fullNameByUserId.get(g.sourceActorId) ?? emailById.get(g.sourceActorId) ?? 'Unknown',
      totalMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
      expenseCount: g._count.expenseId,
    }));
  }
}
