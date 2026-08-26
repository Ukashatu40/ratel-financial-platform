// src/contexts/financial-period/application/handlers/reopen-period.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';
import { ReopenPeriodCommand } from '../commands/reopen-period.command';

/**
 * Reopens a closed period so records stranded by the close can be finished.
 *
 * Nine call sites across Expense and Payroll refuse to mutate anything once a
 * period is not open. Without this handler, an expense left in
 * `pending_approval` when its period closed could neither be approved NOR
 * rejected — permanently stuck, through entirely ordinary use (close the month,
 * then find an expense nobody got to).
 *
 * `OPEN_STATUSES` already includes 'reopened', so every one of those nine call
 * sites starts working again the instant this commits. No changes were needed
 * outside this context.
 */
@Injectable()
export class ReopenPeriodHandler implements CommandHandler<ReopenPeriodCommand, void> {
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: ReopenPeriodCommand): Promise<void> {
    return this.uow.transaction(async (tx) => {
      // Org-scoped lookup, so another organization's period id is simply not
      // found. Deliberately NOT repo.findById() — see the port's comment.
      const period = await this.repo.findByIdForOrganization(
        cmd.periodId,
        cmd.organizationId,
        tx,
      );
      if (!period) throw new EntityNotFoundError('FinancialPeriod', cmd.periodId);

      // Orchestration only. Whether this transition is legal, and whether the
      // reason is acceptable, are the aggregate's decisions (Phase 5.2 rule) —
      // both throw before anything is written.
      period.reopen(cmd.reopenedById, cmd.reason);

      await this.repo.save(period, tx);
      // Enqueued INSIDE the transaction, non-negotiably: the audit entry for a
      // reopened financial period must not be able to exist without the reopen,
      // or the reopen without the audit entry.
      await this.outbox.enqueue(period.pullDomainEvents(), tx);
    });
  }
}
