// src/notifications/application/notification.queries.ts
export class ListNotificationsQuery {
  constructor(
    readonly organizationId: string,
    readonly status?: 'pending' | 'sent' | 'failed',
  ) {}
}
export class GetNotificationByIdQuery {
  constructor(
    readonly notificationId: string,
    readonly organizationId: string,
  ) {}
}
