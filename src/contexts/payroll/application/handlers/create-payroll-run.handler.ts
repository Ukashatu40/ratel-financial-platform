// src/contexts/payroll/application/handlers/create-payroll-run.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { DomainError, NoOpenPeriodError } from '../../../../shared-kernel/errors/domain-error';
import { PERIOD_STATUS_PORT, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import { PAYROLL_RUN_REPOSITORY, PayrollRunRepository } from '../../domain/ports/payroll-run-repository.port';
import { PayrollRun } from '../../domain/aggregates/payroll-run.aggregate';
import { CreatePayrollRunCommand } from '../commands/create-payroll-run.command';

export class PayrollRunAlreadyExistsError extends DomainError {
  readonly code = 'payroll-run-already-exists';
  readonly httpStatus = 409;

  constructor(organizationId: string, runMonth: Date) {
    super(`A payroll run already exists for ${organizationId} in ${runMonth.toISOString().slice(0, 7)}`);
  }
}

@Injectable()
export class CreatePayrollRunHandler implements CommandHandler<CreatePayrollRunCommand, { id: string }> {
  constructor(
    @Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CreatePayrollRunCommand): Promise<{ id: string }> {
    const openPeriod = await this.periodStatus.currentOpenPeriod(cmd.organizationId);
    if (!openPeriod) throw new NoOpenPeriodError(cmd.organizationId);

    return this.uow.transaction(async (tx) => {
      const existing = await this.repo.findByOrgAndMonth(cmd.organizationId, cmd.runMonth, tx);
      if (existing) throw new PayrollRunAlreadyExistsError(cmd.organizationId, cmd.runMonth);

      const run = PayrollRun.create({
        organizationId: cmd.organizationId,
        periodId: openPeriod.id,
        runMonth: cmd.runMonth,
        createdById: cmd.createdById,
      });

      await this.repo.save(run, tx);
      await this.outbox.enqueue(run.pullDomainEvents(), tx);

      return { id: run.id };
    });
  }
}