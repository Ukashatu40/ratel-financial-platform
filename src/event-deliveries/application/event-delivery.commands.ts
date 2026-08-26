// src/event-deliveries/application/event-delivery.commands.ts
export class RetryEventDeliveryCommand {
  constructor(
    readonly deliveryId: string,
    readonly organizationId: string,
  ) {}
}
