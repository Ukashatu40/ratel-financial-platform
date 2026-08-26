// src/contexts/payroll/domain/aggregates/salary-structure.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { SalaryLineItem } from '../value-objects/salary-line-item';
import { serializeLineItems } from '../value-objects/salary-line-item';

export interface SalaryStructureProps {
  id: string;
  organizationId: string;
  employeeId: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo: Date | null; // null = currently active version
  baseSalaryLineItems: SalaryLineItem[]; // recurring allowances/deductions; loans are added per-run, not here
  createdAt: Date;
}

export class SalaryStructure extends AggregateRoot {
  private constructor(private props: SalaryStructureProps) {
    super();
  }

  /**
   * Creating a new version does NOT mutate any prior version — it closes
   * the previous one's effectiveTo and inserts a new row. This is what
   * makes Payslip's snapshot-at-generation-time approach safe: the
   * structure a payslip captured months ago is provably the one that was
   * actually in effect then, not something reachable by later edits.
   */
  static createInitialVersion(input: {
    organizationId: string;
    employeeId: string;
    effectiveFrom: Date;
    baseSalaryLineItems: SalaryLineItem[];
  }): SalaryStructure {
    return new SalaryStructure({
      id: randomUUID(),
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      version: 1,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      baseSalaryLineItems: input.baseSalaryLineItems,
      createdAt: new Date(),
    });
  }

  static createNextVersion(
    previous: SalaryStructure,
    input: {
      effectiveFrom: Date;
      baseSalaryLineItems: SalaryLineItem[];
    },
  ): SalaryStructure {
    return new SalaryStructure({
      id: randomUUID(),
      organizationId: previous.props.organizationId,
      employeeId: previous.props.employeeId,
      version: previous.props.version + 1,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      baseSalaryLineItems: input.baseSalaryLineItems,
      createdAt: new Date(),
    });
  }

  static reconstitute(props: SalaryStructureProps): SalaryStructure {
    const structure = new SalaryStructure(props);
    structure.captureBaseline();
    return structure;
  }

  protected snapshotState(): Record<string, unknown> {
    return this.toProps();
  }

  toSnapshot(): Record<string, unknown> {
    // Exactly what gets frozen into Payslip.salaryStructureSnapshot —
    // centralizing the shape here means there's one place that defines
    // "what a snapshot looks like," not one per call site.
    return {
      salaryStructureId: this.props.id,
      version: this.props.version,
      effectiveFrom: this.props.effectiveFrom.toISOString(),
      baseSalaryLineItems: serializeLineItems(this.props.baseSalaryLineItems), // <-- was raw SalaryLineItem[] with live Money instances before; now genuinely serializable
    };
  }

  get id(): string {
    return this.props.id;
  }
  get employeeId(): string {
    return this.props.employeeId;
  }
  get baseSalaryLineItems(): readonly SalaryLineItem[] {
    return this.props.baseSalaryLineItems;
  }

  toProps(): Readonly<SalaryStructureProps> {
    return { ...this.props };
  }
}
