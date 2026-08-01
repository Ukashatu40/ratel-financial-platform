// src/contexts/payroll/domain/ports/payroll-run-repository.port.ts
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { PayrollRun } from '../aggregates/payroll-run.aggregate';

export interface PayrollRunRepository {
  findById(id: string, tx?: TransactionClient): Promise<PayrollRun | null>;
  findByOrgAndMonth(organizationId: string, runMonth: Date, tx?: TransactionClient): Promise<PayrollRun | null>;
  save(run: PayrollRun, tx: TransactionClient): Promise<void>;
}

export const PAYROLL_RUN_REPOSITORY = Symbol('PAYROLL_RUN_REPOSITORY');