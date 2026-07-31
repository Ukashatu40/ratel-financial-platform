// src/contexts/expense/application/handlers/reject-expense.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError, PeriodClosedError } from '../../../../shared-kernel/errors/domain-error';
import { PERIOD_STATUS_PORT, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import {
  APPROVAL_PROGRESS_REPOSITORY,
  ApprovalProgressRepository,
} from '../../../../shared-kernel/workflow/approval-progress-repository.port';
import { WorkflowEngine } from '../../../../shared-kernel/workflow/workflow-engine';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { RejectExpenseCommand } from '../commands/reject-expense.command';

@Injectable()
export class RejectExpenseHandler implements CommandHandler<RejectExpenseCommand, void> {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(APPROVAL_PROGRESS_REPOSITORY) private readonly progressRepo: ApprovalProgressRepository,
    private readonly workflowEngine: WorkflowEngine,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: RejectExpenseCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      const expense = await this.repo.findById(cmd.expenseId, tx);
      if (!expense || expense.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('Expense', cmd.expenseId);
      }

      const isOpen = await this.periodStatus.isOpen(cmd.organizationId, expense.periodId);
      if (!isOpen) throw new PeriodClosedError(expense.periodId);

      const progress = await this.progressRepo.findByItemId(expense.id, tx);
      if (!progress) throw new EntityNotFoundError('ApprovalProgress', expense.id);

      // Rejection at any step ends the whole workflow — no partial-chain
      // rejection concept, unlike approval which can be mid-chain.
      this.workflowEngine.recordRejection(progress, cmd.approverId, cmd.reason);
      expense.reject(cmd.approverId, cmd.reason);

      await this.progressRepo.save(expense.id, progress, tx);
      await this.repo.save(expense, tx);
      await this.outbox.enqueue(expense.pullDomainEvents(), tx);
    });
  }
}