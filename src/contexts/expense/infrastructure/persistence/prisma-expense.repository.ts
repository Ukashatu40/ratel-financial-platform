// src/contexts/expense/infrastructure/persistence/prisma-expense.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { Expense, ExpenseProps } from '../../domain/aggregates/expense.aggregate';
import { ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { Cursor, Page } from '../../../../shared-kernel/pagination/cursor';
import { ExpenseListFilter } from '../../domain/ports/expense-repository.port';

type ExpenseRow = {
  id: string;
  organizationId: string;
  expenseNumber: string;
  status: string;
  sourceType: string;
  sourceActorId: string;
  sourceImportJobId: string | null;
  amountMinorUnits: bigint;
  currency: string;
  categoryId: string;
  vendorId: string | null;
  departmentId: string;
  projectId: string | null;
  periodId: string;
  parentExpenseId: string | null;
  adjustmentReason: string | null;
  expenseDate: Date;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaExpenseRepository implements ExpenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx?: TransactionClient): Promise<Expense | null> {
    const client = tx ?? this.prisma;
    // Composite PK (id, expenseDate) means a plain findUnique-by-id alone
    // isn't available — findFirst on id is fine here since id is still
    // globally unique (just not the WHOLE key), and this table won't be
    // large enough yet for the extra scan to matter. Revisit if/when the
    // partitioning deferred above actually lands.
    const row = await client.expense.findFirst({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findMany(filter: ExpenseListFilter): Promise<Page<Expense>> {
    const where: any = { organizationId: filter.organizationId };

    if (filter.departmentIds?.length) where.departmentId = { in: filter.departmentIds };
    if (filter.requesterId) where.sourceActorId = filter.requesterId;
    if (filter.status?.length) where.status = { in: filter.status as any };

    if (filter.cursor) {
      // Cursor pagination on (createdAt, id) — standard tie-break pattern
      // (Phase 7.1) for a non-unique-alone sort column.
      where.OR = [
        { createdAt: { lt: new Date(filter.cursor.createdAt) } },
        { createdAt: new Date(filter.cursor.createdAt), id: { lt: filter.cursor.id } },
      ];
    }

    const rows = await this.prisma.expense.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1, // fetch one extra to know if there's a next page
    });

    const hasMore = rows.length > filter.limit;
    const pageRows = hasMore ? rows.slice(0, filter.limit) : rows;
    const items = pageRows.map((row) => this.toDomain(row));

    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            createdAt: pageRows[pageRows.length - 1].createdAt.toISOString(),
            id: pageRows[pageRows.length - 1].id,
          }),
        ).toString('base64url')
      : null;

    return { data: items, nextCursor };
  }

  async save(expense: Expense, tx: TransactionClient): Promise<void> {
    const props = expense.toProps();
    await tx.expense.upsert({
      where: { id_expenseDate: { id: props.id, expenseDate: props.expenseDate } },
      create: this.toRow(props),
      update: {
        status: props.status as any,
        amountMinorUnits: props.amount.minorUnits,
        currency: props.amount.currencyCode,
        categoryId: props.categoryId,
        vendorId: props.vendorId,
        projectId: props.projectId,
        description: props.description,
        updatedAt: props.updatedAt,
      },
    });
  }

  async nextExpenseNumber(organizationId: string, tx?: TransactionClient): Promise<string> {
    const client = tx ?? this.prisma;

    // Atomic increment-and-read via upsert. Running this OUTSIDE a
    // transaction would risk two concurrent expense creations getting the
    // same number — always called from within CreateExpenseHandler's
    // unit-of-work, never standalone, which is why `tx` isn't optional at
    // the call sites even though the type allows it for read-only callers.
    const seq = await client.expenseNumberSequence.upsert({
      where: { organizationId },
      create: { organizationId, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
    });

    const value = seq.nextValue - 1; // the value just consumed
    return `EXP-${value.toString().padStart(6, '0')}`;
  }

  private toRow(props: ExpenseProps) {
    return {
      id: props.id,
      organizationId: props.organizationId,
      expenseNumber: props.expenseNumber,
      status: props.status as any,
      sourceType: props.source.type as any,
      sourceActorId: props.source.actorId,
      sourceImportJobId: props.source.importJobId ?? null,
      amountMinorUnits: props.amount.minorUnits,
      currency: props.amount.currencyCode,
      categoryId: props.categoryId,
      vendorId: props.vendorId,
      departmentId: props.departmentId,
      projectId: props.projectId,
      periodId: props.periodId,
      parentExpenseId: props.parentExpenseId,
      adjustmentReason: props.adjustmentReason,
      expenseDate: props.expenseDate,
      description: props.description,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }

  // Prisma row -> domain aggregate (the ONLY place Prisma types meet the
  // domain layer, per the boundary rule established in Financial Period's
  // repository — Phase 4.3)
  private toDomain(row: ExpenseRow): Expense {
    return Expense.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      expenseNumber: row.expenseNumber,
      status: row.status as any,
      source: {
        type: row.sourceType as any,
        actorId: row.sourceActorId,
        importJobId: row.sourceImportJobId ?? undefined,
      },
      amount: Money.of(row.amountMinorUnits, row.currency),
      categoryId: row.categoryId,
      vendorId: row.vendorId,
      departmentId: row.departmentId,
      projectId: row.projectId,
      periodId: row.periodId,
      parentExpenseId: row.parentExpenseId,
      adjustmentReason: row.adjustmentReason,
      expenseDate: row.expenseDate,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
