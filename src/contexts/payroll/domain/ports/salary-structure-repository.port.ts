// src/contexts/payroll/domain/ports/salary-structure-repository.port.ts
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { SalaryStructure } from '../aggregates/salary-structure.aggregate';

export interface SalaryStructureRepository {
  findActiveForEmployee(employeeId: string, tx?: TransactionClient): Promise<SalaryStructure | null>;
  save(structure: SalaryStructure, tx: TransactionClient): Promise<void>;
}

export const SALARY_STRUCTURE_REPOSITORY = Symbol('SALARY_STRUCTURE_REPOSITORY');