// src/contexts/expense/domain/aggregates/expense.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { InvalidStateTransitionError } from '../../../../shared-kernel/errors/domain-error';
import { ExpenseStatusValue, MUTABLE_STATUSES } from '../value-objects/expense-status';
import { ExpenseSource } from '../value-objects/expense-source';
import { DomainError } from '../../../../shared-kernel/errors/domain-error';
import {
  expenseAdjustmentCreated,
  expenseApproved,
  expenseCancelled,
  expenseDrafted,
  expenseRejected,
  expenseSubmittedForApproval,
} from '../events/expense.events';

export interface ExpenseProps {
  id: string;
  organizationId: string;
  expenseNumber: string;
  status: ExpenseStatusValue;
  source: ExpenseSource;
  amount: Money;
  categoryId: string;
  vendorId: string | null;
  departmentId: string;
  projectId: string | null;
  periodId: string;
  parentExpenseId: string | null;
  adjustmentReason: string | null;
  expenseDate: Date;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AdjustmentReasonRequiredError extends DomainError {
  readonly code = 'adjustment-reason-required';
  readonly httpStatus = 400;

  constructor() {
    super('An adjustment reason is required when creating an expense adjustment');
  }
}

export class ExpenseNotMutableError extends DomainError {
  readonly code = 'expense-not-mutable';
  readonly httpStatus = 409;

  constructor(id: string, status: string) {
    super(`Expense ${id} cannot be edited directly while in status '${status}'. Use createAdjustment() instead.`);
  }
}

export class InvalidAdjustmentAmountError extends DomainError {
  readonly code = 'invalid-adjustment-amount';
  readonly httpStatus = 400;

  constructor() {
    // Zero IS allowed — it's the GL-style full reversal/void case (the
    // original behaviour before adjustments could carry a corrected
    // amount). Only negative is nonsensical: an expense can't cost less
    // than nothing.
    super('An adjustment\'s corrected amount cannot be negative');
  }
}

export class NoOpAdjustmentError extends DomainError {
  readonly code = 'no-op-adjustment';
  readonly httpStatus = 400;

  constructor(originalExpenseId: string) {
    super(
      `The corrected amount equals expense ${originalExpenseId}'s current amount — nothing to adjust`,
    );
  }
}

export class Expense extends AggregateRoot {
  private constructor(private props: ExpenseProps) {
    super();
  }

  // --- Factories (Phase 5.5) ---

  static create(input: {
    organizationId: string;
    expenseNumber: string;
    source: ExpenseSource;
    amount: Money;
    categoryId: string;
    vendorId?: string | null;
    departmentId: string;
    projectId?: string | null;
    periodId: string;
    expenseDate: Date;
    description?: string | null;
  }): Expense {
    if (input.amount.isZero() || input.amount.isNegative()) {
      throw new RangeError('Expense amount must be a positive, non-zero value');
    }

    const now = new Date();
    const expense = new Expense({
      id: randomUUID(),
      organizationId: input.organizationId,
      expenseNumber: input.expenseNumber,
      status: 'draft',
      source: input.source,
      amount: input.amount,
      categoryId: input.categoryId,
      vendorId: input.vendorId ?? null,
      departmentId: input.departmentId,
      projectId: input.projectId ?? null,
      periodId: input.periodId,
      parentExpenseId: null,
      adjustmentReason: null,
      expenseDate: input.expenseDate,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    });

    expense.recordEvent(expenseDrafted(expense.props.id, expense.props.organizationId, expense.props.source));
    return expense;
  }

  /**
   * The ONLY legal way to correct a fact recorded in a closed period (Phase
   * 1/2 decision: adjust, not destructive edit). Produces a NEW Expense
   * linked back to the original via parentExpenseId.
   *
   * `newAmountMinorUnits` is the CORRECTED total, not a delta — the caller
   * says "this expense should have been ₦X", not "adjust it by ₦Y". The
   * persisted `amount` on the adjustment row is still the DELTA
   * (newAmount - original.amount), exactly as it always was: reporting
   * (expense-adjustments-summary) sums adjustment rows as signed
   * corrections against original spend, and the DB's
   * chk_amount_nonzero constraint expects a nonzero delta, not an
   * absolute total. Zero is a legal corrected amount — it's the original
   * GL-style full reversal/void, now just the newAmount=0 special case of
   * the same general mechanism rather than the only thing this method
   * could do.
   *
   * Whether the adjustment needs re-approval is NOT this aggregate's call —
   * that's a business policy decision (increases need sign-off, decreases
   * don't — see ExpenseAdjustmentApprovalPolicy). The caller (application
   * handler) resolves that and passes the answer in as `requiresApproval`.
   * This keeps the aggregate policy-agnostic — exactly the separation
   * enforced in submit()/approve()/reject() above.
   */
  static createAdjustment(input: {
    original: Expense;
    reason: string;
    currentOpenPeriodId: string;
    expenseNumber: string;
    newAmountMinorUnits: bigint;
    requiresApproval: boolean;
  }): Expense {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new AdjustmentReasonRequiredError();
    }
    if (input.newAmountMinorUnits < 0n) {
      throw new InvalidAdjustmentAmountError();
    }

    const original = input.original.props;
    const newAmount = Money.of(input.newAmountMinorUnits, original.amount.currencyCode);
    const delta = newAmount.add(original.amount.negate());
    if (delta.isZero()) {
      throw new NoOpAdjustmentError(original.id);
    }

    const now = new Date();
    const initialStatus: ExpenseStatusValue = input.requiresApproval ? 'pending_approval' : 'approved';

    const adjustment = new Expense({
      id: randomUUID(),
      organizationId: original.organizationId,
      expenseNumber: input.expenseNumber,
      status: initialStatus,
      source: original.source,
      amount: delta,
      categoryId: original.categoryId,
      vendorId: original.vendorId,
      departmentId: original.departmentId,
      projectId: original.projectId,
      periodId: input.currentOpenPeriodId,
      parentExpenseId: original.id,
      adjustmentReason: input.reason,
      expenseDate: now,
      description: `Adjustment for ${original.expenseNumber}: ${input.reason}`,
      createdAt: now,
      updatedAt: now,
    });

    adjustment.recordEvent(
      expenseAdjustmentCreated(adjustment.props.id, adjustment.props.organizationId, original.id, input.reason),
    );

    // If it needs re-approval, it should also emit the "entered the approval
    // pipeline" event — reusing the existing submittedForApproval event
    // rather than inventing a redundant one, so Audit/Reporting subscribers
    // don't need a special case for "adjustment that needs approval" vs.
    // "expense that needs approval".
    if (input.requiresApproval) {
      adjustment.recordEvent(expenseSubmittedForApproval(adjustment.props.id, adjustment.props.organizationId));
    }

    return adjustment;
  }

  static reconstitute(props: ExpenseProps): Expense {
    const expense = new Expense(props);
    expense.captureBaseline();
    return expense;
  }

  protected snapshotState(): Record<string, unknown> {
    return this.toProps();
  }

  // --- Behavior / state machine ---

  update(changes: Partial<Pick<ExpenseProps, 'amount' | 'categoryId' | 'vendorId' | 'projectId' | 'description'>>): void {
    // Editing is only ever legal in 'draft' — this is the domain-layer
    // enforcement of period-close immutability discussed in Phase 2.3,
    // independent of period status: even an OPEN-period expense that has
    // already been submitted/approved must go through createAdjustment(),
    // not a silent edit, once it has left draft.
    if (!MUTABLE_STATUSES.includes(this.props.status)) {
      throw new ExpenseNotMutableError(this.props.id, this.props.status);
    }
    Object.assign(this.props, changes, { updatedAt: new Date() });
  }

  submitForApproval(): void {
    this.assertTransition('pending_approval', ['draft']);
    this.props.status = 'pending_approval';
    this.props.updatedAt = new Date();
    this.recordEvent(expenseSubmittedForApproval(this.props.id, this.props.organizationId));
  }

  /**
   * Marks this expense approved. NOTE: whether the approver is actually
   * authorized, and whether this is the final step in a multi-step chain,
   * is decided by the Workflow/Approval framework at the application layer
   * (piece 2) — this method trusts that decision and only enforces its own
   * state-machine legality (Phase 5.2's separation: aggregate enforces
   * invariants, handler+policy decide business rules).
   */
  approve(approverId: string): void {
    this.assertTransition('approved', ['pending_approval']);
    this.props.status = 'approved';
    this.props.updatedAt = new Date();
    this.recordEvent(expenseApproved(this.props.id, this.props.organizationId, approverId));
  }

  reject(approverId: string, reason: string): void {
    this.assertTransition('rejected', ['pending_approval']);
    this.props.status = 'rejected';
    this.props.updatedAt = new Date();
    this.recordEvent(expenseRejected(this.props.id, this.props.organizationId, approverId, reason));
  }

  cancel(actorId: string): void {
    this.assertTransition('cancelled', ['draft', 'pending_approval']);
    this.props.status = 'cancelled';
    this.props.updatedAt = new Date();
    this.recordEvent(expenseCancelled(this.props.id, this.props.organizationId, actorId));
  }

  private assertTransition(to: ExpenseStatusValue, allowedFrom: ExpenseStatusValue[]): void {
    if (!allowedFrom.includes(this.props.status)) {
      throw new InvalidStateTransitionError('Expense', this.props.status, to);
    }
  }

  // --- Accessors ---

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get status(): ExpenseStatusValue { return this.props.status; }
  get amount(): Money { return this.props.amount; }
  get periodId(): string { return this.props.periodId; }
  get departmentId(): string { return this.props.departmentId; }
  get expenseNumber(): string { return this.props.expenseNumber; }

  toProps(): Readonly<ExpenseProps> {
    return { ...this.props };
  }
}