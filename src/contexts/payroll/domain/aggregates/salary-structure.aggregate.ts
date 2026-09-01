// src/contexts/payroll/domain/aggregates/salary-structure.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { SalaryLineItem } from '../value-objects/salary-line-item';
import { serializeLineItems } from '../value-objects/salary-line-item';
import {
  salaryStructureCreated,
  salaryStructureVersionCreated,
} from '../events/salary-structure.events';

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
   *
   * NOTE (TECH_DEBT #52 investigation): this docstring's "closes the
   * previous one's effectiveTo" is not something this method does itself —
   * confirmed by reading the code below. Whether that closing mutation
   * happens elsewhere (a command handler calling something on `previous`
   * separately) or does not exist yet at all is UNCONFIRMED as of this
   * change. Deliberately not invented here — if it turns out to exist as
   * an in-place mutation on an already-reconstitute()'d instance, it needs
   * its own event (an in-place effectiveTo change IS something the generic
   * props diff could pick up cleanly, unlike the cross-instance comparison
   * below). If it turns out not to exist, that is a real gap worth its own
   * TECH_DEBT entry, not something to paper over here.
   */
  static createInitialVersion(input: {
    organizationId: string;
    employeeId: string;
    effectiveFrom: Date;
    baseSalaryLineItems: SalaryLineItem[];
  }): SalaryStructure {
    const structure = new SalaryStructure({
      id: randomUUID(),
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      version: 1,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      baseSalaryLineItems: input.baseSalaryLineItems,
      createdAt: new Date(),
    });

    // TECH_DEBT #52 (1 of 3) — RESOLVED. Previously recorded zero events at
    // all. No baseline exists for a freshly-constructed instance (only
    // reconstitute() calls captureBaseline), so this carries no `changes` —
    // consistent with every other aggregate's create().
    structure.recordEvent(
      salaryStructureCreated(
        structure.props.id,
        structure.props.organizationId,
        structure.props.employeeId,
        structure.props.version,
        structure.props.effectiveFrom,
      ),
    );
    return structure;
  }

  /**
   * Creating a new version does NOT mutate any prior version — it is
   * INTENDED to close the previous one's effectiveTo and insert a new row,
   * which is what would make Payslip's snapshot-at-generation-time approach
   * safe: the structure a payslip captured months ago would be provably the
   * one actually in effect then, not something reachable by later edits.
   *
   * NOT YET WIRED (TECH_DEBT #55): no command handler calls this method —
   * confirmed by grep against src/contexts/payroll/application/handlers,
   * zero matches. So today there is no way to reach this method through the
   * application at all, and the effectiveTo-closing this docstring describes
   * does not happen anywhere, because nothing happens at all. Fixing that is
   * a new handler, not a #52 diff-visibility fix — out of scope here.
   */
  static createNextVersion(
    previous: SalaryStructure,
    input: {
      effectiveFrom: Date;
      baseSalaryLineItems: SalaryLineItem[];
    },
  ): SalaryStructure {
    const structure = new SalaryStructure({
      id: randomUUID(),
      organizationId: previous.props.organizationId,
      employeeId: previous.props.employeeId,
      version: previous.props.version + 1,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
      baseSalaryLineItems: input.baseSalaryLineItems,
      createdAt: new Date(),
    });

    // TECH_DEBT #52 (1 of 3) — RESOLVED. AggregateRoot's generic props diff
    // (TECH_DEBT #8) cannot apply here: it only ever compares one instance
    // against its own earlier baseline, and this method constructs a brand
    // new instance rather than mutating `previous`. previousVersionId/
    // previousVersion are therefore carried explicitly in the payload —
    // metadata to trace what was superseded, deliberately NOT the full
    // baseSalaryLineItems arrays on both sides.
    structure.recordEvent(
      salaryStructureVersionCreated(
        structure.props.id,
        structure.props.organizationId,
        structure.props.employeeId,
        structure.props.version,
        structure.props.effectiveFrom,
        previous.props.id,
        previous.props.version,
      ),
    );
    return structure;
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
