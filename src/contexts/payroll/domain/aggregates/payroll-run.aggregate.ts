// src/contexts/payroll/domain/aggregates/payroll-run.aggregate.ts
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../../shared-kernel/events/domain-event';
import { Money } from '../../../../shared-kernel/money/money.vo';
import {
  InvalidStateTransitionError,
  DomainError,
} from '../../../../shared-kernel/errors/domain-error';
import { PayrollRunStatusValue, MUTABLE_RUN_STATUSES } from '../value-objects/payroll-run-status';
import { Payslip } from '../entities/payslip.entity';
import {
  payrollRunApproved,
  payrollRunCancelled,
  payrollRunCreated,
  payrollRunProcessed,
  payrollRunProcessingStarted,
  payrollRunRejected,
  payrollRunSubmittedForApproval,
  payslipGenerated,
} from '../events/payroll-run.events';

export interface PayrollRunProps {
  id: string;
  organizationId: string;
  periodId: string;
  status: PayrollRunStatusValue;
  runMonth: Date;
  createdById: string; // the payroll admin who initiated the run — this is what fills Approvable.requesterId
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export class DuplicatePayslipError extends DomainError {
  readonly code = 'duplicate-payslip';
  readonly httpStatus = 409;

  constructor(runId: string, employeeId: string) {
    super(`Payroll run ${runId} already has a payslip for employee ${employeeId}`);
  }
}

export class EmptyPayrollRunError extends DomainError {
  readonly code = 'empty-payroll-run';
  readonly httpStatus = 409;

  constructor(runId: string) {
    super(`Payroll run ${runId} cannot be submitted for approval with zero payslips`);
  }
}

export class PayrollRunNotMutableError extends DomainError {
  readonly code = 'payroll-run-not-mutable';
  readonly httpStatus = 409;

  constructor(id: string, status: PayrollRunStatusValue) {
    super(`Payroll run ${id} cannot be modified while in status '${status}'`);
  }
}

export class PayrollRun extends AggregateRoot {
  private payslips: Payslip[] = [];

  private constructor(private props: PayrollRunProps) {
    super();
  }

  static create(input: {
    organizationId: string;
    periodId: string;
    runMonth: Date;
    createdById: string;
  }): PayrollRun {
    const run = new PayrollRun({
      id: randomUUID(),
      organizationId: input.organizationId,
      periodId: input.periodId,
      status: 'draft',
      runMonth: input.runMonth,
      createdById: input.createdById,
      approvedById: null,
      approvedAt: null,
      createdAt: new Date(),
    });

    run.recordEvent(payrollRunCreated(run.props.id, run.props.organizationId, run.props.runMonth));
    return run;
  }

  static reconstitute(props: PayrollRunProps, payslips: Payslip[]): PayrollRun {
    const run = new PayrollRun(props);
    run.payslips = payslips;
    run.captureBaseline();
    return run;
  }

  /**
   * TECH_DEBT #52 (3 of 3) — payslips is a sibling array, not part of props,
   * so the generic props diff in AggregateRoot could never see it change.
   * Including a derived payslipCount here means addPayslip()'s existing
   * recordEvent(payslipGenerated(...)) call now automatically gets a
   * `changes: { payslipCount: { from, to } }` payload — no other method
   * needed to change, since payslipCount is identical before/after every
   * other mutation and so never appears in their diffs.
   */
  protected snapshotState(): Record<string, unknown> {
    return { ...this.toProps(), payslipCount: this.payslips.length };
  }

  /**
   * Adding a payslip is only legal while the run is still 'draft' — same
   * mutability rule as Expense's update(), enforced the same way (Phase
   * 2.3's discipline generalized to the second context, confirming the
   * pattern wasn't accidentally Expense-specific).
   */
  addPayslip(payslip: Payslip): void {
    if (!MUTABLE_RUN_STATUSES.includes(this.props.status)) {
      throw new PayrollRunNotMutableError(this.props.id, this.props.status);
    }
    if (this.payslips.some((p) => p.employeeId === payslip.employeeId)) {
      throw new DuplicatePayslipError(this.props.id, payslip.employeeId);
    }
    this.payslips.push(payslip);
    this.recordEvent(
      payslipGenerated(
        this.props.id,
        this.props.organizationId,
        payslip.employeeId,
        payslip.netPay.minorUnits,
      ),
    );
  }

  submitForApproval(): void {
    this.assertTransition('pending_approval', ['draft']);
    if (this.payslips.length === 0) {
      throw new EmptyPayrollRunError(this.props.id);
    }
    this.props.status = 'pending_approval';
    this.recordEvent(payrollRunSubmittedForApproval(this.props.id, this.props.organizationId));
  }

  /** Same trust boundary as Expense.approve() — the Workflow framework
   * (piece 2's WorkflowEngine, reused unmodified) decides whether this is
   * the final approval; this method only enforces state-machine legality.
   */
  approve(approverId: string): void {
    this.assertTransition('approved', ['pending_approval']);
    this.props.status = 'approved';
    this.props.approvedById = approverId;
    this.props.approvedAt = new Date();
    this.recordEvent(payrollRunApproved(this.props.id, this.props.organizationId, approverId));
  }

  reject(approverId: string, reason: string): void {
    this.assertTransition('draft', ['pending_approval']); // rejected runs go back to draft for correction, not a dead-end 'rejected' state — payroll admin fixes and resubmits
    this.props.status = 'draft';
    this.recordEvent(
      payrollRunRejected(this.props.id, this.props.organizationId, approverId, reason),
    );
  }

  /**
   * TECH_DEBT #52 (2 of 3) — RESOLVED. Previously mutated status with no
   * recordEvent call at all, unlike complete() immediately below, so the
   * trail jumped straight from 'approved' to 'completed'. System-triggered
   * (no actor parameter, by design — confirmed this is not a human action).
   */
  startProcessing(): void {
    this.assertTransition('processing', ['approved']);
    this.props.status = 'processing';
    this.recordEvent(payrollRunProcessingStarted(this.props.id, this.props.organizationId));
  }

  complete(): void {
    this.assertTransition('completed', ['processing']);
    this.props.status = 'completed';
    this.recordEvent(payrollRunProcessed(this.props.id, this.props.organizationId));
  }

  cancel(actorId: string): void {
    this.assertTransition('cancelled', ['draft', 'pending_approval']);
    this.props.status = 'cancelled';
    this.recordEvent(payrollRunCancelled(this.props.id, this.props.organizationId, actorId));
  }

  totalGrossPay(currency: string): Money {
    return this.payslips.reduce((sum, p) => sum.add(p.grossPay), Money.of(0n, currency));
  }

  private assertTransition(to: PayrollRunStatusValue, allowedFrom: PayrollRunStatusValue[]): void {
    if (!allowedFrom.includes(this.props.status)) {
      throw new InvalidStateTransitionError('PayrollRun', this.props.status, to);
    }
  }

  get id(): string {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get periodId(): string {
    return this.props.periodId;
  }
  get status(): PayrollRunStatusValue {
    return this.props.status;
  }
  get createdById(): string {
    return this.props.createdById;
  }
  get getPayslips(): readonly Payslip[] {
    return this.payslips;
  }

  toProps(): Readonly<PayrollRunProps> {
    return { ...this.props };
  }
}
