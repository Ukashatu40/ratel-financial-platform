// src/contexts/financial-period/infrastructure/persistence/prisma-financial-period.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { FinancialPeriod } from '../../domain/aggregates/financial-period.aggregate';
import { FinancialPeriodRepository } from '../../domain/ports/financial-period-repository.port';
import { OPEN_STATUSES } from '../../domain/value-objects/period-status';

@Injectable()
export class PrismaFinancialPeriodRepository implements FinancialPeriodRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx?: TransactionClient): Promise<FinancialPeriod | null> {
    const client = tx ?? this.prisma;
    const row = await client.financialPeriod.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findCurrentOpen(organizationId: string, tx?: TransactionClient): Promise<FinancialPeriod | null> {
    const client = tx ?? this.prisma;
    const row = await client.financialPeriod.findFirst({
      where: { organizationId, status: { in: OPEN_STATUSES as any } },
      orderBy: { startDate: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  async save(period: FinancialPeriod, tx: TransactionClient): Promise<void> {
    const props = period.toProps();
    await tx.financialPeriod.upsert({
      where: { id: props.id },
      create: {
        id: props.id,
        organizationId: props.organizationId,
        startDate: props.startDate,
        endDate: props.endDate,
        status: props.status as any,
        closedById: props.closedById,
        closedAt: props.closedAt,
        createdAt: props.createdAt,
      },
      update: {
        status: props.status as any,
        closedById: props.closedById,
        closedAt: props.closedAt,
      },
    });
  }

  // Prisma row -> domain aggregate. This is the ONLY place Prisma's generated
  // types are allowed to meet the domain layer (Phase 4.3 boundary rule).
  private toDomain(row: {
    id: string;
    organizationId: string;
    startDate: Date;
    endDate: Date;
    status: string;
    closedById: string | null;
    closedAt: Date | null;
    createdAt: Date;
  }): FinancialPeriod {
    return FinancialPeriod.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status as any,
      closedById: row.closedById,
      closedAt: row.closedAt,
      createdAt: row.createdAt,
    });
  }
}