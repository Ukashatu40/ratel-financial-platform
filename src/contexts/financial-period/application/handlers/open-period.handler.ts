// src/contexts/financial-period/application/handlers/open-period.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { FinancialPeriod } from '../../domain/aggregates/financial-period.aggregate';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';
import { OpenPeriodCommand } from '../commands/open-period.command';

@Injectable()
export class OpenPeriodHandler implements CommandHandler<OpenPeriodCommand, { id: string }> {
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: OpenPeriodCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const period = FinancialPeriod.create({
        organizationId: cmd.organizationId,
        startDate: cmd.startDate,
        endDate: cmd.endDate,
      });

      await this.repo.save(period, tx);
      await this.outbox.enqueue(period.pullDomainEvents(), tx);

      return { id: period.id };
    });
  }
}