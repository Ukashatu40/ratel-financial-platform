// src/contexts/payroll/domain/events/salary-structure.events.ts
import { DomainEvent } from '../../../../shared-kernel/events/domain-event';

const AGGREGATE_TYPE = 'SalaryStructure';

/**
 * TECH_DEBT #52 (1 of 3) — SalaryStructure previously recorded zero events
 * at all, so compensation changes produced no audit entry whatsoever. No
 * `changes` diff is expected or attempted here, matching every other
 * aggregate's create() — "nothing existed before" is the honest record.
 */
export function salaryStructureCreated(
  structureId: string,
  organizationId: string,
  employeeId: string,
  version: number,
  effectiveFrom: Date,
): DomainEvent {
  return {
    type: 'SalaryStructureCreated',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: structureId,
    occurredAt: new Date(),
    payload: { organizationId, employeeId, version, effectiveFrom: effectiveFrom.toISOString() },
  };
}

/**
 * TECH_DEBT #52 (1 of 3), continued. createNextVersion() builds a brand-new
 * instance rather than mutating an existing one, so AggregateRoot's generic
 * props diff cannot compare old-instance-state to new-instance-state — it
 * only ever diffs an aggregate against its own earlier self. previousVersionId/
 * previousVersion are carried explicitly for that reason: metadata for a
 * reader to trace what was superseded, not a duplication of the full
 * baseSalaryLineItems arrays on both sides (deliberately excluded).
 */
export function salaryStructureVersionCreated(
  structureId: string,
  organizationId: string,
  employeeId: string,
  version: number,
  effectiveFrom: Date,
  previousVersionId: string,
  previousVersion: number,
): DomainEvent {
  return {
    type: 'SalaryStructureVersionCreated',
    aggregateType: AGGREGATE_TYPE,
    aggregateId: structureId,
    occurredAt: new Date(),
    payload: {
      organizationId,
      employeeId,
      version,
      effectiveFrom: effectiveFrom.toISOString(),
      previousVersionId,
      previousVersion,
    },
  };
}
