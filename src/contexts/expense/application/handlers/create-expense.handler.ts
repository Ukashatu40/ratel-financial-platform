// src/contexts/expense/application/handlers/create-expense.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { Money } from '../../../../shared-kernel/money/money.vo';
import {
  InactiveOrMissingReferenceDataError,
  NoOpenPeriodError,
} from '../../../../shared-kernel/errors/domain-error';
import {
  PERIOD_STATUS_PORT,
  PeriodStatusPort,
} from '../../../../shared-kernel/period-status/period-status.port';
import { PrismaService } from '../../../../prisma/prisma.service';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { Expense } from '../../domain/aggregates/expense.aggregate';
import { CreateExpenseCommand } from '../commands/create-expense.command';

@Injectable()
export class CreateExpenseHandler implements CommandHandler<
  CreateExpenseCommand,
  { id: string; expenseNumber: string }
> {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CreateExpenseCommand): Promise<{ id: string; expenseNumber: string }> {
    const openPeriod = await this.periodStatus.currentOpenPeriod(cmd.organizationId);
    if (!openPeriod) throw new NoOpenPeriodError(cmd.organizationId);

    // Validate every referenced piece of reference data exists AND is
    // active, BEFORE entering the transaction — fails fast with a clean
    // domain error rather than relying on the DB's FK constraint (which
    // would surface as a raw Prisma error) or silently allowing a
    // deactivated department/category/vendor/project to be used
    // (TECH_DEBT #39). Optional fields (vendor, project) are only checked
    // when actually provided.
    const department = await this.prisma.department.findFirst({
      where: { id: cmd.departmentId, organizationId: cmd.organizationId, isActive: true },
    });
    if (!department) throw new InactiveOrMissingReferenceDataError('Department', cmd.departmentId);

    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: cmd.categoryId, organizationId: cmd.organizationId, isActive: true },
    });
    if (!category) throw new InactiveOrMissingReferenceDataError('ExpenseCategory', cmd.categoryId);

    if (cmd.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: cmd.vendorId, organizationId: cmd.organizationId, isActive: true },
      });
      if (!vendor) throw new InactiveOrMissingReferenceDataError('Vendor', cmd.vendorId);
    }

    if (cmd.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: cmd.projectId, organizationId: cmd.organizationId, isActive: true },
      });
      if (!project) throw new InactiveOrMissingReferenceDataError('Project', cmd.projectId);
    }

    return this.uow.transaction(async (tx) => {
      const expenseNumber = await this.repo.nextExpenseNumber(cmd.organizationId, tx);

      const expense = Expense.create({
        organizationId: cmd.organizationId,
        expenseNumber,
        source: cmd.source,
        amount: Money.of(cmd.amountMinorUnits, cmd.currency),
        categoryId: cmd.categoryId,
        vendorId: cmd.vendorId,
        departmentId: cmd.departmentId,
        projectId: cmd.projectId,
        periodId: openPeriod.id,
        expenseDate: cmd.expenseDate,
        description: cmd.description,
      });

      await this.repo.save(expense, tx);
      await this.outbox.enqueue(expense.pullDomainEvents(), tx);

      return { id: expense.id, expenseNumber: expense.expenseNumber };
    });
  }
}
