// src/contexts/payroll/application/handlers/submit-payroll-run.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError, PeriodClosedError } from '../../../../shared-kernel/errors/domain-error';
import { PERIOD_STATUS_PORT, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import { APPROVAL_POLICY, ApprovalPolicy } from '../../../../shared-kernel/workflow/approval-policy.port';
import {
  APPROVAL_PROGRESS_REPOSITORY,
  ApprovalProgressRepository,
} from '../../../../shared-kernel/workflow/approval-progress-repository.port';
import { WorkflowEngine } from '../../../../shared-kernel/workflow/workflow-engine';
import { PAYROLL_RUN_REPOSITORY, PayrollRunRepository } from '../../domain/ports/payroll-run-repository.port';
import { payrollRunToApprovable } from '../mappers/payroll-run-to-approvable.mapper';
import { SubmitPayrollRunCommand } from '../commands/submit-payroll-run.command';

const DEFAULT_CURRENCY = 'NGN';

@Injectable()
export class SubmitPayrollRunHandler implements CommandHandler<SubmitPayrollRunCommand, void> {
  constructor(
    @Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(APPROVAL_POLICY) private readonly approvalPolicy: ApprovalPolicy,
    @Inject(APPROVAL_PROGRESS_REPOSITORY) private readonly progressRepo: ApprovalProgressRepository,
    private readonly workflowEngine: WorkflowEngine,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: SubmitPayrollRunCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      const run = await this.repo.findById(cmd.payrollRunId, tx);
      if (!run || run.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('PayrollRun', cmd.payrollRunId);
      }

      const isOpen = await this.periodStatus.isOpen(cmd.organizationId, run.periodId);
      if (!isOpen) throw new PeriodClosedError(run.periodId);

      // submitForApproval() itself enforces the empty-run check (piece 1) —
      // fails loudly before we ever touch the workflow chain.
      run.submitForApproval();

      const chain = this.workflowEngine.resolveChainFor(
        payrollRunToApprovable(run, DEFAULT_CURRENCY),
        this.approvalPolicy,
      );
      // PayrollApprovalPolicy never returns an empty chain (piece 2) — no
      // auto-approve branch needed here, unlike Expense's submit handler.
      await this.progressRepo.initialize(run.id, 'PayrollRun', chain, tx);

      await this.repo.save(run, tx);
      await this.outbox.enqueue(run.pullDomainEvents(), tx);
    });
  }
}