// src/contexts/payroll/domain/events/payroll-run.events.ts
import { DomainEvent } from '../../../../shared-kernel/events/domain-event';

const AGGREGATE_TYPE = 'PayrollRun';

export function payrollRunCreated(
  runId: string,
  organizationId: string,
  runMonth: Date,
): DomainEvent {
  return {
    type: 'PayrollRunCreated',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId, runMonth },
  };
}

export function payslipGenerated(
  runId: string,
  organizationId: string,
  employeeId: string,
  netPayMinorUnits: bigint,
): DomainEvent {
  return {
    type: 'PayslipGenerated',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId, employeeId, netPayMinorUnits: netPayMinorUnits.toString() },
  };
}

export function payrollRunSubmittedForApproval(runId: string, organizationId: string): DomainEvent {
  return {
    type: 'PayrollRunSubmittedForApproval',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId },
  };
}

export function payrollRunApproved(
  runId: string,
  organizationId: string,
  approverId: string,
): DomainEvent {
  return {
    type: 'PayrollRunApproved',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId, approverId },
  };
}

export function payrollRunRejected(
  runId: string,
  organizationId: string,
  approverId: string,
  reason: string,
): DomainEvent {
  return {
    type: 'PayrollRunRejected',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId, approverId, reason },
  };
}

/**
 * TECH_DEBT #52 (2 of 3) — the transition into 'processing' was previously
 * invisible to the audit trail: PayrollRun.startProcessing() mutated status
 * with no recordEvent call, so the history jumped straight from 'approved'
 * to 'completed'. Deliberately no actor parameter — this transition is
 * system-triggered, unlike approve()/reject()/cancel(), which all take one.
 */
export function payrollRunProcessingStarted(runId: string, organizationId: string): DomainEvent {
  return {
    type: 'PayrollRunProcessingStarted',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId },
  };
}

export function payrollRunProcessed(runId: string, organizationId: string): DomainEvent {
  return {
    type: 'PayrollRunProcessed',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId },
  };
}

export function payrollRunCancelled(
  runId: string,
  organizationId: string,
  actorId: string,
): DomainEvent {
  return {
    type: 'PayrollRunCancelled',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: runId,
    occurredAt: new Date(),
    payload: { organizationId, actorId },
  };
}
