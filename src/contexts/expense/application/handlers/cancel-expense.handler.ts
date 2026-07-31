// src/contexts/expense/application/handlers/cancel-expense.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError, PeriodClosedError } from '../../../../shared-kernel/errors/domain-error';
import { PERIOD_STATUS_PORT, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { CancelExpenseCommand } from '../commands/cancel-expense.command';

@Injectable()
export class CancelExpenseHandler implements CommandHandler<CancelExpenseCommand, void> {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CancelExpenseCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      const expense = await this.repo.findById(cmd.expenseId, tx);
      if (!expense || expense.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('Expense', cmd.expenseId);
      }

      const isOpen = await this.periodStatus.isOpen(cmd.organizationId, expense.periodId);
      if (!isOpen) throw new PeriodClosedError(expense.periodId);

      expense.cancel(cmd.actorId);

      await this.repo.save(expense, tx);
      await this.outbox.enqueue(expense.pullDomainEvents(), tx);
    });
  }
}