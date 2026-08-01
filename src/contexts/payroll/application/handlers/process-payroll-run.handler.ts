// src/contexts/payroll/application/handlers/process-payroll-run.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import { PAYROLL_RUN_REPOSITORY, PayrollRunRepository } from '../../domain/ports/payroll-run-repository.port';
import { ProcessPayrollRunCommand } from '../commands/process-payroll-run.command';

/**
 * IMPORTANT — placeholder scope: this handler only models the domain state
 * transition (approved -> processing -> completed). It does NOT perform
 * actual disbursement (bank transfer initiation, payment gateway calls,
 * etc.) — that belongs in a BullMQ processor (jobs/processors/, per the
 * original blueprint) once a disbursement provider is chosen. Calling this
 * today marks a run "processed" without any money having actually moved,
 * which is fine for now but must NOT be mistaken for a working payroll
 * disbursement pipeline.
 */
@Injectable()
export class ProcessPayrollRunHandler implements CommandHandler<ProcessPayrollRunCommand, void> {
  constructor(
    @Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: ProcessPayrollRunCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      const run = await this.repo.findById(cmd.payrollRunId, tx);
      if (!run || run.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('PayrollRun', cmd.payrollRunId);
      }

      run.startProcessing();
      run.complete(); // synchronous no-op "processing" until real disbursement exists

      await this.repo.save(run, tx);
      await this.outbox.enqueue(run.pullDomainEvents(), tx);
    });
  }
}