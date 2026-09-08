// src/jobs/processors/notification.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from '../../shared-kernel/notifications/email-provider.port';
import { USER_ROLE_SERVICE, UserRoleService } from '../../shared-kernel/auth/user-role.port';
import { Prisma } from '@prisma/client';
import {
  getSubjectFor,
  NotificationTemplateType,
  renderTemplate,
} from '../../notifications/templates/notification-templates';
import { NOTIFICATION_QUEUE } from '../queues/notification.queue';

interface NotificationJobPayload {
  recipientUserId: string;
  templateType: NotificationTemplateType;
  templateData: Record<string, unknown>;
}

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(USER_ROLE_SERVICE) private readonly userRoles: UserRoleService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobPayload>): Promise<void> {
    const { recipientUserId, templateType, templateData } = job.data;

    const user = await this.prisma.user.findUnique({ where: { id: recipientUserId } });
    if (!user) {
      this.logger.warn(`Notification recipient ${recipientUserId} not found — skipping`);
      return;
    }

    // TECH_DEBT #14 — was a direct userRoleAssignment.findFirst(); now uses
    // the same seam AuthService uses. Any assignment's organizationId is
    // fine here (matches the original's intent — just attributing the log
    // row to SOME org this user belongs to), so [0] is fine even though
    // getRolesForUser can return rows from either table interleaved.
    const [roleAssignment] = await this.userRoles.getRolesForUser(recipientUserId);

    const log = await this.prisma.notificationLog.create({
      data: {
        id: randomUUID(),
        organizationId: roleAssignment?.organizationId ?? 'unknown',
        recipientUserId,
        channel: 'email',
        templateType,
        templateData: templateData as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    });

    try {
      await this.emailProvider.send({
        to: user.email,
        subject: getSubjectFor(templateType),
        html: renderTemplate(templateType, templateData),
      });
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent', sentAt: new Date() },
      });

      this.logger.log(
        `Notification sent: ${templateType} to ${user.email} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
    } catch (err) {
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', errorMessage: (err as Error).message },
      });

      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.error(
        `Notification FAILED: ${templateType} to ${user.email} — attempt ${job.attemptsMade + 1}/${job.opts.attempts} — ` +
          `${isLastAttempt ? 'PERMANENTLY FAILED, no more retries' : 'will retry'} — ${(err as Error).message}`,
      );

      throw err;
    }
  }
}
