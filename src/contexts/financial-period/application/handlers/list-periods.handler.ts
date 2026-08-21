// src/contexts/financial-period/application/handlers/list-periods.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';
import { ListPeriodsQuery } from '../queries/list-periods.query';
import { FinancialPeriodProps } from '../../domain/aggregates/financial-period.aggregate';

/**
 * Period discovery. Needed because `findCurrentOpen` matches OPEN_STATUSES only,
 * so `GET /financial-periods/current` can never surface a CLOSED period — which
 * is exactly the id a reopen requires. Without this, reopen would be an endpoint
 * whose input could not be obtained through the API.
 *
 * Returns `FinancialPeriodProps`, the same explicit projection type
 * GetCurrentOpenPeriodHandler already returns, rather than `any` — the shape #21
 * showed matters, where an `any` return type let a broken projection ship.
 */
@Injectable()
export class ListPeriodsHandler implements QueryHandler<ListPeriodsQuery, FinancialPeriodProps[]> {
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
  ) {}

  async execute(query: ListPeriodsQuery): Promise<FinancialPeriodProps[]> {
    const periods = await this.repo.findManyForOrganization(query.organizationId, query.status);
    return periods.map((period) => period.toProps());
  }
}
