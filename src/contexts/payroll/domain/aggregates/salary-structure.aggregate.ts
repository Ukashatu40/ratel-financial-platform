// src/contexts/payroll/domain/aggregates/salary-structure.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { DomainError } from '../../../../shared-kernel/errors/domain-error';
import { SalaryLineItem } from '../value-objects/salary-line-item';
import { serializeLineItems } from '../value-objects/salary-line-item';
import {
  salaryStructureClosed,
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

export class SalaryStructureAlreadyExistsError extends DomainError {
  readonly code = 'salary-structure-already-exists';
  readonly httpStatus = 409;

  constructor(employeeId: string) {
    super(`Employee ${employeeId} already has an active salary structure`);
  }
}

export class SalaryStructure extends AggregateRoot {
  private constructor(private props: SalaryStructureProps) {
    super();
  }

  /**
   * Creating a new version does NOT mutate any prior version — closing the
   * previous one's effectiveTo is now the caller's explicit responsibility via
   * close() (see below), not something this factory does implicitly. This is
   * what makes Payslip's snapshot-at-generation-time approach safe: the
   * structure a payslip captured months ago is provably the one that was
   * actually in effect then, not something reachable by later edits.
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

  /**
   * TECH_DEBT #56 — closes this version's effective period, called on the
   * PREVIOUS version when a successor takes over. Mutates props before
   * recordEvent(), the same convention every other aggregate method follows,
   * which means AggregateRoot's generic diff (#8) picks this up automatically
   * as `changes: { effectiveTo: { from: null, to: <date> } }`.
   *
   * Only correct when `this` was loaded via reconstitute() — a fresh
   * create()'d instance has no baseline to diff against. The only caller
   * (CreateSalaryStructureVersionHandler) resolves `previous` via the
   * repository, so this precondition always holds in practice; not enforced
   * here defensively, matching this codebase's existing style of trusting
   * mutate-then-record ordering rather than guarding it per-call.
   */
  close(effectiveTo: Date): void {
    this.props.effectiveTo = effectiveTo;
    this.recordEvent(
      salaryStructureClosed(
        this.props.id,
        this.props.organizationId,
        this.props.employeeId,
        this.props.version,
        effectiveTo,
      ),
    );
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
    return {
      salaryStructureId: this.props.id,
      version: this.props.version,
      effectiveFrom: this.props.effectiveFrom.toISOString(),
      baseSalaryLineItems: serializeLineItems(this.props.baseSalaryLineItems),
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
