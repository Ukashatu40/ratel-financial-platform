// src/reference-data/domain/reference-data.events.ts
import { DomainEvent } from '../../shared-kernel/events/domain-event';

export type ReferenceDataType = 'Department' | 'Vendor' | 'ExpenseCategory' | 'Project';

export function referenceDataCreated(
  type: ReferenceDataType,
  id: string,
  organizationId: string,
  name: string,
): DomainEvent {
  return {
    type: `${type}Created`,
    aggregateType: type,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, name },
  };
}

export function referenceDataUpdated(
  type: ReferenceDataType,
  id: string,
  organizationId: string,
  name: string,
): DomainEvent {
  return {
    type: `${type}Updated`,
    aggregateType: type,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, name },
  };
}

export function referenceDataDeactivated(
  type: ReferenceDataType,
  id: string,
  organizationId: string,
  deactivatedById: string,
): DomainEvent {
  return {
    type: `${type}Deactivated`,
    aggregateType: type,
    aggregateId: id,
    occurredAt: new Date(),
    payload: { organizationId, actorId: deactivatedById },
  };
}
