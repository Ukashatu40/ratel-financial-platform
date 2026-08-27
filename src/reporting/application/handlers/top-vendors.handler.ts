// src/reporting/application/handlers/top-vendors.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import {
  EFFECTIVE_SCOPE_RESOLVER,
  EffectiveScopeResolver,
} from '../../../shared-kernel/auth/effective-scope-resolver.port';
import { Prisma } from '@prisma/client';
import { TopVendorsQuery } from '../queries/top-vendors.query';

export interface VendorSpendingRow {
  vendorId: string;
  vendorName: string;
  totalMinorUnits: string;
  expenseCount: number;
}

@Injectable()
export class TopVendorsHandler implements QueryHandler<TopVendorsQuery, VendorSpendingRow[]> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EFFECTIVE_SCOPE_RESOLVER) private readonly scopeResolver: EffectiveScopeResolver,
  ) {}

  async execute(query: TopVendorsQuery): Promise<VendorSpendingRow[]> {
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
      vendorId: { not: null },
    };
    if (scope === 'department') {
      where.departmentId = {
        in: user.roles.filter((r) => r.departmentId).map((r) => r.departmentId!),
      };
    }

    const grouped = await this.prisma.expenseReadModel.groupBy({
      by: ['vendorId', 'vendorName'],
      where,
      _sum: { amountMinorUnits: true },
      _count: { expenseId: true },
      orderBy: { _sum: { amountMinorUnits: 'desc' } },
      take: query.limit,
    });

    return grouped
      .filter((g) => g.vendorId !== null)
      .map((g) => ({
        vendorId: g.vendorId!,
        vendorName: g.vendorName ?? 'Unknown',
        totalMinorUnits: (g._sum.amountMinorUnits ?? 0n).toString(),
        expenseCount: g._count.expenseId,
      }));
  }
}
