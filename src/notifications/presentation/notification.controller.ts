// src/notifications/presentation/notification.controller.ts
import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  ListNotificationsHandler,
  GetNotificationByIdHandler,
  RetryNotificationHandler,
} from '../application/notification.handlers';
import {
  ListNotificationsQuery,
  GetNotificationByIdQuery,
} from '../application/notification.queries';
import { RetryNotificationCommand } from '../application/notification.commands';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationController {
  constructor(
    private readonly listNotifications: ListNotificationsHandler,
    private readonly getNotificationById: GetNotificationByIdHandler,
    private readonly retryNotification: RetryNotificationHandler,
  ) {}

  @ApiOperation({ summary: 'List notification delivery attempts, optionally filtered by status' })
  @RequirePermission('notification:manage')
  @Get()
  async list(
    @Query('status') status: 'pending' | 'sent' | 'failed' | undefined,
    @CurrentUser() user: UserPrincipal,
  ) {
    return this.listNotifications.execute(new ListNotificationsQuery(user.organizationId, status));
  }

  @ApiOperation({ summary: 'Get a single notification delivery attempt' })
  @RequirePermission('notification:manage')
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getNotificationById.execute(new GetNotificationByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'Manually re-enqueue a permanently-failed notification' })
  @RequirePermission('notification:manage')
  @Post(':id/retry')
  async retry(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.retryNotification.execute(new RetryNotificationCommand(id, user.organizationId));
  }
}
