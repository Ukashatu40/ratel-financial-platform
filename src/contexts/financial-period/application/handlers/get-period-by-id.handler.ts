// src/contexts/financial-period/application/handlers/get-period-by-id.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';
import { GetPeriodByIdQuery } from '../queries/get-period-by-id.query';
import { FinancialPeriodProps } from '../../domain/aggregates/financial-period.aggregate';

@Injectable()
export class GetPeriodByIdHandler
  implements QueryHandler<GetPeriodByIdQuery, FinancialPeriodProps>
{
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
  ) {}

  async execute(query: GetPeriodByIdQuery): Promise<FinancialPeriodProps> {
    const period = await this.repo.findByIdForOrganization(query.periodId, query.organizationId);
    // 404 rather than 403 for another organization's period: indistinguishable
    // from "does not exist", so this cannot enumerate foreign period ids.
    if (!period) throw new EntityNotFoundError('FinancialPeriod', query.periodId);
    return period.toProps();
  }
}
