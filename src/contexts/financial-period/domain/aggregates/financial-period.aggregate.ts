// src/contexts/financial-period/domain/aggregates/financial-period.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { InvalidStateTransitionError } from '../../../../shared-kernel/errors/domain-error';
import { OPEN_STATUSES, PeriodStatusValue } from '../value-objects/period-status';
import { periodClosed, periodClosing, periodOpened, periodReopened } from '../events/financial-period.events';

export interface FinancialPeriodProps {
  id: string;
  organizationId: string;
  startDate: Date;
  endDate: Date;
  status: PeriodStatusValue;
  closedById: string | null;
  closedAt: Date | null;
  createdAt: Date;
}

export class InvalidPeriodDatesError extends Error {
  constructor() {
    super('Financial period end_date must be after start_date');
    this.name = 'InvalidPeriodDatesError';
  }
}

export class FinancialPeriod extends AggregateRoot {
  private constructor(private props: FinancialPeriodProps) {
    super();
  }

  // --- Factories (Phase 5.5: create() enforces invariants, reconstitute() doesn't) ---

  static create(input: {
    organizationId: string;
    startDate: Date;
    endDate: Date;
  }): FinancialPeriod {
    if (input.endDate <= input.startDate) {
      throw new InvalidPeriodDatesError();
    }

    const period = new FinancialPeriod({
      id: randomUUID(),
      organizationId: input.organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'open',
      closedById: null,
      closedAt: null,
      createdAt: new Date(),
    });

    period.recordEvent(periodOpened(period.props.id, period.props.organizationId));
    return period;
  }

  static reconstitute(props: FinancialPeriodProps): FinancialPeriod {
    return new FinancialPeriod(props);
  }

  // --- Behavior ---

  startClosing(): void {
    this.assertTransition('closing', ['open']);
    this.props.status = 'closing';
    this.recordEvent(periodClosing(this.props.id, this.props.organizationId));
  }

  close(closedById: string): void {
    this.assertTransition('closed', ['open', 'closing']);
    this.props.status = 'closed';
    this.props.closedById = closedById;
    this.props.closedAt = new Date();
    this.recordEvent(periodClosed(this.props.id, this.props.organizationId, closedById));
  }

  reopen(reopenedById: string): void {
    this.assertTransition('reopened', ['closed']);
    this.props.status = 'reopened';
    this.props.closedById = null;
    this.props.closedAt = null;
    this.recordEvent(periodReopened(this.props.id, this.props.organizationId, reopenedById));
  }

  isOpen(): boolean {
    return (OPEN_STATUSES as string[]).includes(this.props.status);
  }

  private assertTransition(to: PeriodStatusValue, allowedFrom: PeriodStatusValue[]): void {
    if (!allowedFrom.includes(this.props.status)) {
      throw new InvalidStateTransitionError('FinancialPeriod', this.props.status, to);
    }
  }

  // --- Accessors (read-only projection of state, no setters) ---

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get startDate(): Date { return this.props.startDate; }
  get endDate(): Date { return this.props.endDate; }
  get status(): PeriodStatusValue { return this.props.status; }
  get closedAt(): Date | null { return this.props.closedAt; }

  toProps(): Readonly<FinancialPeriodProps> {
    return { ...this.props };
  }
}