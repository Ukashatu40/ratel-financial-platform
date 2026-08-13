// src/notifications/application/notification.commands.ts
export class RetryNotificationCommand {
  constructor(
    readonly notificationId: string,
    readonly organizationId: string,
  ) {}
}
