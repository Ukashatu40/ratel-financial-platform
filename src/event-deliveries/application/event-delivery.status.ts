// src/event-deliveries/application/event-delivery.status.ts
import { DomainError } from '../../shared-kernel/errors/domain-error';

/**
 * Mirrors Prisma's `EventDeliveryStatus` enum. Restated here rather than
 * imported from `@prisma/client` so the application layer isn't shaped by the
 * persistence layer's generated types, and so the validated list below sits next
 * to the error thrown when it fails.
 */
export const EVENT_DELIVERY_STATUSES = ['pending_retry', 'recovered', 'permanently_failed'] as const;

export type EventDeliveryStatus = (typeof EVENT_DELIVERY_STATUSES)[number];

export class InvalidEventDeliveryStatusError extends DomainError {
  readonly code = 'invalid-event-delivery-status';
  readonly httpStatus = 400;
  constructor(value: string) {
    super(
      `'${value}' is not a valid event delivery status. ` +
        `Expected one of: ${EVENT_DELIVERY_STATUSES.join(', ')}.`,
    );
  }
}

/**
 * Validated at the boundary rather than passed straight to Prisma. An unknown
 * value reaching `where: { status }` surfaces as a raw Prisma validation error —
 * a generic 500 with no useful body, since `ProblemDetailsFilter` only renders
 * `DomainError` subclasses properly (critical convention #5). A caller who
 * typos a filter deserves to be told which values exist.
 */
export function parseEventDeliveryStatus(value: string | undefined): EventDeliveryStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if ((EVENT_DELIVERY_STATUSES as readonly string[]).includes(value)) {
    return value as EventDeliveryStatus;
  }
  throw new InvalidEventDeliveryStatusError(value);
}
