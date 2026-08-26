// src/contexts/financial-period/domain/aggregates/financial-period.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { DomainError, InvalidStateTransitionError } from '../../../../shared-kernel/errors/domain-error';
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

/**
 * Both errors below extend DomainError, per critical convention #5, so
 * ProblemDetailsFilter renders a real RFC 7807 400 naming the actual problem
 * rather than swallowing it. A bare Error here does not merely lose the status
 * code: the filter's fallback branch replaces the message with the fixed string
 * "An unexpected error occurred", so the caller is told nothing about what they
 * got wrong. `name` is not set explicitly — DomainError's constructor already
 * assigns `this.constructor.name`.
 */
export class InvalidPeriodDatesError extends DomainError {
  readonly code = 'invalid-period-dates';
  readonly httpStatus = 400;

  constructor() {
    super('Financial period end_date must be after start_date');
  }
}

export class PeriodReopenReasonRequiredError extends DomainError {
  readonly code = 'period-reopen-reason-required';
  readonly httpStatus = 400;

  constructor() {
    super('A reason is required to reopen a closed financial period');
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

  reopen(reopenedById: string, reason: string): void {
    this.assertTransition('reopened', ['closed']);

    // Checked here, not only in the DTO: the aggregate owns its invariants, and a
    // "required" reason that accepts whitespace is not required. Reopening a
    // closed financial period must never be recorded without a stated cause,
    // whatever route reaches this method.
    const trimmed = reason?.trim() ?? '';
    if (trimmed.length === 0) throw new PeriodReopenReasonRequiredError();

    this.props.status = 'reopened';
    this.props.closedById = null;
    this.props.closedAt = null;
    this.recordEvent(
      periodReopened(this.props.id, this.props.organizationId, reopenedById, trimmed),
    );
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