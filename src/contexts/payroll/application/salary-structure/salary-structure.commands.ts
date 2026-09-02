// src/contexts/payroll/application/salary-structure/salary-structure.commands.ts
import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';

export class CreateSalaryStructureCommand {
  constructor(
    public readonly organizationId: string,
    public readonly employeeId: string,
    public readonly effectiveFrom: Date,
    public readonly baseSalaryLineItems: SalaryLineItem[],
  ) {}
}

export class CreateSalaryStructureVersionCommand {
  constructor(
    public readonly organizationId: string,
    public readonly employeeId: string,
    public readonly effectiveFrom: Date,
    public readonly baseSalaryLineItems: SalaryLineItem[],
  ) {}
}
