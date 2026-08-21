// src/contexts/financial-period/application/handlers/close-period.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';
import { ClosePeriodCommand } from '../commands/close-period.command';

@Injectable()
export class ClosePeriodHandler implements CommandHandler<ClosePeriodCommand, void> {
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: ClosePeriodCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      // Org-scoped lookup, so another organization's period id is simply not
      // found rather than closable. Until #49 this was `findById(cmd.periodId)`,
      // which ignored the organizationId the command has always carried — so any
      // caller holding `period:close` could close another organization's period.
      const period = await this.repo.findByIdForOrganization(
        cmd.periodId,
        cmd.organizationId,
        tx,
      );
      if (!period) throw new EntityNotFoundError('FinancialPeriod', cmd.periodId);

      // NOTE: this handler only orchestrates. Whether 'open' -> 'closed' is a
      // legal jump (skipping 'closing') is the aggregate's call, not this
      // handler's — see assertTransition() in the aggregate (Phase 5.2 rule).
      period.close(cmd.closedById);

      await this.repo.save(period, tx);
      await this.outbox.enqueue(period.pullDomainEvents(), tx);
    });
  }
}