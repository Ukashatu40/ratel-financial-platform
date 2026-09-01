// src/contexts/payroll/application/handlers/cancel-payroll-run.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  PAYROLL_RUN_REPOSITORY,
  PayrollRunRepository,
} from '../../domain/ports/payroll-run-repository.port';
import { CancelPayrollRunCommand } from '../commands/cancel-payroll-run.command';

@Injectable()
export class CancelPayrollRunHandler implements CommandHandler<CancelPayrollRunCommand, void> {
  constructor(
    @Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CancelPayrollRunCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      const run = await this.repo.findById(cmd.payrollRunId, tx);
      if (!run || run.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('PayrollRun', cmd.payrollRunId);
      }

      run.cancel(cmd.actorId);

      await this.repo.save(run, tx);
      await this.outbox.enqueue(run.pullDomainEvents(), tx);
    });
  }
}
