import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { SalaryStructure } from '../aggregates/salary-structure.aggregate';

export interface SalaryStructureRepository {
  findActiveForEmployee(
    employeeId: string,
    tx?: TransactionClient,
  ): Promise<SalaryStructure | null>;

  /** Inserts a brand-new structure (version 1, or any version saved standalone). */
  save(structure: SalaryStructure, tx: TransactionClient): Promise<void>;

  /**
   * TECH_DEBT #56 — persists a version transition atomically: closes
   * `previous` (already mutated via previous.close()) and inserts `next`,
   * against the same TransactionClient. Replaces the old design, where
   * save() alone derived the closing UPDATE purely from the NEW structure's
   * props, with no aggregate instance for the row actually being changed
   * ever involved in the decision.
   */
  saveNextVersion(
    previous: SalaryStructure,
    next: SalaryStructure,
    tx: TransactionClient,
  ): Promise<void>;
}

export const SALARY_STRUCTURE_REPOSITORY = Symbol('SALARY_STRUCTURE_REPOSITORY');
