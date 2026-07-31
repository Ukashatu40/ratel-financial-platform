// src/contexts/expense/application/handlers/create-adjustment.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError, NoOpenPeriodError } from '../../../../shared-kernel/errors/domain-error';
import { PERIOD_STATUS_PORT, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import {
  ADJUSTMENT_APPROVAL_POLICY,
  AdjustmentApprovalPolicy,
} from '../../../../shared-kernel/workflow/adjustment-approval-policy.port';
import { APPROVAL_POLICY, ApprovalPolicy } from '../../../../shared-kernel/workflow/approval-policy.port';
import {
  APPROVAL_PROGRESS_REPOSITORY,
  ApprovalProgressRepository,
} from '../../../../shared-kernel/workflow/approval-progress-repository.port';
import { WorkflowEngine } from '../../../../shared-kernel/workflow/workflow-engine';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { Expense } from '../../domain/aggregates/expense.aggregate';
import { expenseToApprovable } from '../mappers/expense-to-approvable.mapper';
import { CreateAdjustmentCommand } from '../commands/create-adjustment.command';

@Injectable()
export class CreateAdjustmentHandler implements CommandHandler<CreateAdjustmentCommand, { id: string }> {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly repo: ExpenseRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(ADJUSTMENT_APPROVAL_POLICY) private readonly adjustmentPolicy: AdjustmentApprovalPolicy,
    @Inject(APPROVAL_POLICY) private readonly approvalPolicy: ApprovalPolicy,
    @Inject(APPROVAL_PROGRESS_REPOSITORY) private readonly progressRepo: ApprovalProgressRepository,
    private readonly workflowEngine: WorkflowEngine,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CreateAdjustmentCommand): Promise<{ id: string }> {
    const openPeriod = await this.periodStatus.currentOpenPeriod(cmd.organizationId);
    if (!openPeriod) throw new NoOpenPeriodError(cmd.organizationId);

    return this.uow.transaction(async (tx) => {
      const original = await this.repo.findById(cmd.originalExpenseId, tx);
      if (!original || original.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('Expense', cmd.originalExpenseId);
      }

      const requiresApproval = this.adjustmentPolicy.requiresApproval(
        original.amount.minorUnits,
        cmd.reason,
      );
      const expenseNumber = await this.repo.nextExpenseNumber(cmd.organizationId, tx);

      const adjustment = Expense.createAdjustment({
        original,
        reason: cmd.reason,
        currentOpenPeriodId: openPeriod.id,
        expenseNumber,
        requiresApproval,
      });

      await this.repo.save(adjustment, tx);

      if (requiresApproval) {
        const chain = this.workflowEngine.resolveChainFor(
          expenseToApprovable(adjustment),
          this.approvalPolicy,
        );
        await this.progressRepo.initialize(adjustment.id, chain, tx);
      }

      await this.outbox.enqueue(adjustment.pullDomainEvents(), tx);
      return { id: adjustment.id };
    });
  }
}