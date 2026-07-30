// src/contexts/financial-period/domain/ports/financial-period-repository.port.ts
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { FinancialPeriod } from '../aggregates/financial-period.aggregate';

export interface FinancialPeriodRepository {
  findById(id: string, tx?: TransactionClient): Promise<FinancialPeriod | null>;
  findCurrentOpen(organizationId: string, tx?: TransactionClient): Promise<FinancialPeriod | null>;
  save(period: FinancialPeriod, tx: TransactionClient): Promise<void>;
}

export const FINANCIAL_PERIOD_REPOSITORY = Symbol('FINANCIAL_PERIOD_REPOSITORY');