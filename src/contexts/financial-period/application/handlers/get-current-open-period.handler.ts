// src/contexts/financial-period/application/handlers/get-current-open-period.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';
import { GetCurrentOpenPeriodQuery } from '../queries/get-current-open-period.query';
import { FinancialPeriodProps } from '../../domain/aggregates/financial-period.aggregate';

@Injectable()
export class GetCurrentOpenPeriodHandler
  implements QueryHandler<GetCurrentOpenPeriodQuery, FinancialPeriodProps | null>
{
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
  ) {}

  async execute(query: GetCurrentOpenPeriodQuery): Promise<FinancialPeriodProps | null> {
    const period = await this.repo.findCurrentOpen(query.organizationId);
    return period ? period.toProps() : null;
  }
}