// src/contexts/payroll/application/handlers/approve-payroll-run.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import {
  EntityNotFoundError,
  PeriodClosedError,
} from '../../../../shared-kernel/errors/domain-error';
import {
  PERIOD_STATUS_PORT,
  PeriodStatusPort,
} from '../../../../shared-kernel/period-status/period-status.port';
import {
  APPROVAL_PROGRESS_REPOSITORY,
  ApprovalProgressRepository,
} from '../../../../shared-kernel/workflow/approval-progress-repository.port';
import { WorkflowEngine } from '../../../../shared-kernel/workflow/workflow-engine';
import {
  PAYROLL_RUN_REPOSITORY,
  PayrollRunRepository,
} from '../../domain/ports/payroll-run-repository.port';
import { payrollRunToApprovable } from '../mappers/payroll-run-to-approvable.mapper';
import { ApprovePayrollRunCommand } from '../commands/approve-payroll-run.command';

const DEFAULT_CURRENCY = 'NGN';

@Injectable()
export class ApprovePayrollRunHandler implements CommandHandler<ApprovePayrollRunCommand, void> {
  constructor(
    @Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(APPROVAL_PROGRESS_REPOSITORY) private readonly progressRepo: ApprovalProgressRepository,
    private readonly workflowEngine: WorkflowEngine,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: ApprovePayrollRunCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      const run = await this.repo.findById(cmd.payrollRunId, tx);
      if (!run || run.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('PayrollRun', cmd.payrollRunId);
      }

      const isOpen = await this.periodStatus.isOpen(cmd.organizationId, run.periodId);
      if (!isOpen) throw new PeriodClosedError(run.periodId);

      const progress = await this.progressRepo.findByItemId(run.id, tx);
      if (!progress) throw new EntityNotFoundError('ApprovalProgress', run.id);

      // Same chokepoint as Expense — SelfApprovalNotAllowedError fires here
      // too if createdById === approverId, reused without modification.
      const { isFinalApproval } = await this.workflowEngine.recordApproval(
        payrollRunToApprovable(run, DEFAULT_CURRENCY),
        progress,
        cmd.approverId,
      );

      if (isFinalApproval) {
        run.approve(cmd.approverId);
      }

      await this.progressRepo.save(run.id, progress, tx);
      await this.repo.save(run, tx);
      await this.outbox.enqueue(run.pullDomainEvents(), tx);
    });
  }
}
