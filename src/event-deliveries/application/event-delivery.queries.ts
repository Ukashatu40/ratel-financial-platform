// src/event-deliveries/application/event-delivery.queries.ts
import { EventDeliveryStatus } from './event-delivery.status';

export class ListEventDeliveriesQuery {
  constructor(
    readonly organizationId: string,
    readonly status?: EventDeliveryStatus,
  ) {}
}

export class GetEventDeliveryByIdQuery {
  constructor(
    readonly deliveryId: string,
    readonly organizationId: string,
  ) {}
}
