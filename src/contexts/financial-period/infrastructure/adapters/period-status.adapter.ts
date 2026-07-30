// src/contexts/financial-period/infrastructure/adapters/period-status.adapter.ts
import { Inject, Injectable } from '@nestjs/common';
import { PeriodRef, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import {
  FINANCIAL_PERIOD_REPOSITORY,
  FinancialPeriodRepository,
} from '../../domain/ports/financial-period-repository.port';

/**
 * Implements the shared-kernel PeriodStatusPort (Phase 3.2) on top of this
 * context's own repository. Expense/Payroll never see this class directly —
 * they only ever inject PERIOD_STATUS_PORT and get this bound to it.
 */
@Injectable()
export class PeriodStatusAdapter implements PeriodStatusPort {
  constructor(
    @Inject(FINANCIAL_PERIOD_REPOSITORY) private readonly repo: FinancialPeriodRepository,
  ) {}

  async isOpen(organizationId: string, periodId: string): Promise<boolean> {
    const period = await this.repo.findById(periodId);
    if (!period || period.organizationId !== organizationId) return false;
    return period.isOpen();
  }

  async currentOpenPeriod(organizationId: string): Promise<PeriodRef | null> {
    const period = await this.repo.findCurrentOpen(organizationId);
    if (!period) return null;
    return {
      id: period.id,
      organizationId: period.organizationId,
      startDate: period.startDate,
      endDate: period.endDate,
    };
  }
}