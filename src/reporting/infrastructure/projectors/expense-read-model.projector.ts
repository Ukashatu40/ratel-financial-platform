// src/reporting/infrastructure/projectors/expense-read-model.projector.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventDispatcher } from '../../../shared-kernel/events/domain-event-dispatcher';
import { DomainEvent } from '../../../shared-kernel/events/domain-event';

const PROJECTED_EVENT_TYPES = [
  'ExpenseDrafted',
  'ExpenseSubmittedForApproval',
  'ExpenseApproved',
  'ExpenseRejected',
  'ExpenseCancelled',
  'ExpenseAdjustmentCreated',
];

/**
 * Self-registers against the shared DomainEventDispatcher, same pattern as
 * AuditSubscriber — except AuditSubscriber uses registerGlobal() (every
 * event type, Conformist per Phase 3.5), while this registers only for the
 * specific event types it actually needs to react to, since it's not a
 * Conformist — it has its own opinion about what's worth projecting.
 */
@Injectable()
export class ExpenseReadModelProjector implements OnModuleInit {
  private readonly logger = new Logger(ExpenseReadModelProjector.name);

  constructor(
    private readonly dispatcher: DomainEventDispatcher,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    PROJECTED_EVENT_TYPES.forEach((type) =>
      this.dispatcher.register(
        type,
        (e) => this.projectFromSource(e),
        'ExpenseReadModelProjector',
      ),
    );
  }

  private async projectFromSource(event: DomainEvent): Promise<void> {
    const expenseId = event.aggregateId;

    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId } });
    if (!expense) {
      // Shouldn't happen in practice (the write-side row always exists by
      // the time its own event is dispatched), but a projector should
      // never crash the dispatcher over a transient race — log and move on.
      this.logger.warn(
        `Source expense ${expenseId} not found while projecting ${event.type} — skipping`,
      );
      return;
    }

    const [department, category, vendor, project] = await Promise.all([
      this.prisma.department.findUnique({ where: { id: expense.departmentId } }),
      this.prisma.expenseCategory.findUnique({ where: { id: expense.categoryId } }),
      expense.vendorId
        ? this.prisma.vendor.findUnique({ where: { id: expense.vendorId } })
        : Promise.resolve(null),
      expense.projectId
        ? this.prisma.project.findUnique({ where: { id: expense.projectId } })
        : Promise.resolve(null), // NEW
    ]);

    await this.prisma.expenseReadModel.upsert({
      where: { expenseId: expense.id },
      create: {
        expenseId: expense.id,
        organizationId: expense.organizationId,
        departmentId: expense.departmentId,
        departmentName: department?.name ?? 'Unknown',
        categoryId: expense.categoryId,
        categoryName: category?.name ?? 'Unknown',
        vendorId: expense.vendorId,
        vendorName: vendor?.name ?? null,
        projectId: expense.projectId,
        projectName: project?.name ?? null,
        amountMinorUnits: expense.amountMinorUnits,
        currency: expense.currency,
        status: expense.status,
        expenseDate: expense.expenseDate,
        parentExpenseId: expense.parentExpenseId,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
      },
      update: {
        // Full re-sync, not just status — a category/vendor/amount could
        // theoretically have changed too (e.g. draft edits before submit).
        departmentName: department?.name ?? 'Unknown',
        categoryName: category?.name ?? 'Unknown',
        vendorName: vendor?.name ?? null,
        projectName: project?.name ?? null,
        amountMinorUnits: expense.amountMinorUnits,
        status: expense.status,
        updatedAt: expense.updatedAt,
      },
    });
  }
}
