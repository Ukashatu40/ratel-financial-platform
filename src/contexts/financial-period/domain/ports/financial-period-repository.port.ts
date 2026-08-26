// src/contexts/financial-period/domain/ports/financial-period-repository.port.ts
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { FinancialPeriod } from '../aggregates/financial-period.aggregate';
import { PeriodStatusValue } from '../value-objects/period-status';

export interface FinancialPeriodRepository {
  findById(id: string, tx?: TransactionClient): Promise<FinancialPeriod | null>;
  findCurrentOpen(organizationId: string, tx?: TransactionClient): Promise<FinancialPeriod | null>;

  /**
   * Resolves a period by id AND owning organization in one query, so a caller can
   * never act on another organization's period.
   *
   * Both mutating handlers (close and reopen) go through this. `findById` is kept
   * only for `PeriodStatusAdapter`, which does its own organization comparison
   * after the fetch — safe, because it returns a boolean rather than mutating
   * anything. Prefer this method for any new lookup that precedes a write: #49 was
   * exactly the bug that arises from using the unscoped one out of habit.
   */
  findByIdForOrganization(
    id: string,
    organizationId: string,
    tx?: TransactionClient,
  ): Promise<FinancialPeriod | null>;

  /** Newest first. Optional status filter; undefined means "every status". */
  findManyForOrganization(
    organizationId: string,
    status?: PeriodStatusValue,
    tx?: TransactionClient,
  ): Promise<FinancialPeriod[]>;

  save(period: FinancialPeriod, tx: TransactionClient): Promise<void>;
}

export const FINANCIAL_PERIOD_REPOSITORY = Symbol('FINANCIAL_PERIOD_REPOSITORY');