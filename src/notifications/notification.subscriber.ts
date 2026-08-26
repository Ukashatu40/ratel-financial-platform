// src/notifications/notification.subscriber.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventDispatcher } from '../shared-kernel/events/domain-event-dispatcher';
import { DomainEvent } from '../shared-kernel/events/domain-event';
import { NOTIFICATION_JOB, NOTIFICATION_QUEUE } from '../jobs/queues/notification.queue';
import { NotificationTemplateType } from './templates/notification-templates';

interface RecipientResolution {
  recipientUserId: string;
  templateType: NotificationTemplateType;
  templateData: Record<string, unknown>;
}

/**
 * Registers per-event-type (not global like AuditSubscriber) — notification
 * intent is genuinely event-specific, unlike audit which wants everything.
 * Resolves WHO gets notified and WHAT data the template needs, then hands
 * off to the queue — actual email/SMS sending happens in the processor,
 * async, matching the outbox/import/audit pattern already established
 * throughout this build rather than sending synchronously inline here.
 */
@Injectable()
export class NotificationSubscriber implements OnModuleInit {
  private readonly logger = new Logger(NotificationSubscriber.name, { timestamp: true });
  constructor(
    private readonly dispatcher: DomainEventDispatcher,
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    // Same subscriber name across all types: it is one subscriber that happens to
    // care about several events, and redelivery resolves the handler per event type,
    // so there is no ambiguity.
    this.dispatcher.register(
      'ExpenseApproved',
      (e) => this.handleExpenseApproved(e),
      'NotificationSubscriber',
    );
    this.dispatcher.register(
      'ExpenseRejected',
      (e) => this.handleExpenseRejected(e),
      'NotificationSubscriber',
    );
    this.dispatcher.register(
      'PayrollRunApproved',
      (e) => this.handlePayrollRunApproved(e),
      'NotificationSubscriber',
    );
    // --- Added closing TECH_DEBT #32 ---
    this.dispatcher.register(
      'PayrollRunRejected',
      (e) => this.handlePayrollRunRejected(e),
      'NotificationSubscriber',
    );
    this.dispatcher.register(
      'PeriodClosed',
      (e) => this.handlePeriodStatusChange(e, 'PeriodClosed'),
      'NotificationSubscriber',
    );
    this.dispatcher.register(
      'PeriodReopened',
      (e) => this.handlePeriodStatusChange(e, 'PeriodReopened'),
      'NotificationSubscriber',
    );
  }

  private async handleExpenseApproved(event: DomainEvent): Promise<void> {
    const expense = await this.prisma.expense.findFirst({ where: { id: event.aggregateId } });
    if (!expense) return;

    // Notify the ORIGINAL REQUESTER, not the approver — the person who
    // needs to know their expense went through is whoever created it.
    await this.enqueue({
      recipientUserId: expense.sourceActorId,
      templateType: 'ExpenseApproved',
      templateData: {
        expenseNumber: expense.expenseNumber,
        amount: `${expense.currency} ${(Number(expense.amountMinorUnits) / 100).toFixed(2)}`,
        approverName: (event.payload['approverId'] as string) ?? 'a manager',
      },
    });
  }

  private async handleExpenseRejected(event: DomainEvent): Promise<void> {
    const expense = await this.prisma.expense.findFirst({ where: { id: event.aggregateId } });
    if (!expense) return;

    await this.enqueue({
      recipientUserId: expense.sourceActorId,
      templateType: 'ExpenseRejected',
      templateData: {
        expenseNumber: expense.expenseNumber,
        amount: `${expense.currency} ${(Number(expense.amountMinorUnits) / 100).toFixed(2)}`,
        reason: (event.payload['reason'] as string) ?? 'No reason provided',
      },
    });
  }

  private async handlePayrollRunApproved(event: DomainEvent): Promise<void> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: event.aggregateId },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) return;

    // Admin-facing notification — unchanged, still useful on its own
    // (confirms the RUN went through, distinct from each employee's
    // individual pay notification below).
    await this.enqueue({
      recipientUserId: run.createdById,
      templateType: 'PayrollRunApproved',
      templateData: { runMonth: run.runMonth.toISOString().slice(0, 7) },
    });

    for (const payslip of run.payslips) {
      if (!payslip.employee.userId) {
        // Genuinely expected, not an error — an Employee with no linked
        // User account has no login/email to notify. Logged at debug so
        // it's traceable without being alarming.
        this.logger.debug(
          `Employee ${payslip.employeeId} has no linked User account — skipping payslip notification`,
        );
        continue;
      }

      await this.enqueue({
        recipientUserId: payslip.employee.userId,
        templateType: 'PayslipReady',
        templateData: {
          runMonth: run.runMonth.toISOString().slice(0, 7),
          netPay: `${payslip.currency} ${(Number(payslip.netPayMinorUnits) / 100).toFixed(2)}`,
        },
      });
    }
  }
  /**
   * Mirrors handleExpenseRejected: the person who needs to know is whoever created
   * the thing that got rejected, not the approver who rejected it. Before this, a
   * payroll admin whose run was sent back learned about it only by going and looking
   * — the asymmetry with ExpenseRejected recorded under #32.
   *
   * Note the run is back in `draft` by the time this fires, not a terminal `rejected`
   * state — a deliberate design choice recorded as #11 — so "review and resubmit" is
   * genuinely actionable advice rather than a dead end.
   */
  private async handlePayrollRunRejected(event: DomainEvent): Promise<void> {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: event.aggregateId } });
    if (!run) return;

    await this.enqueue({
      recipientUserId: run.createdById,
      templateType: 'PayrollRunRejected',
      templateData: {
        runMonth: run.runMonth.toISOString().slice(0, 7),
        reason: (event.payload['reason'] as string) ?? 'No reason provided',
      },
    });
  }

  /**
   * PeriodClosed / PeriodReopened. One handler for both because recipient resolution
   * is identical and only the template and its data differ — two near-duplicate
   * methods would be the kind of drift-prone copy this codebase avoids elsewhere.
   *
   * Recipients are resolved from the PERMISSION table rather than a hardcoded role
   * list, for the reason critical convention #2 exists: `role_permissions` is the
   * single source of truth for who holds what, so granting `period:close` to a new
   * role automatically starts notifying it with no change here. A hardcoded
   * ['finance_director'] would silently drift the moment that grant changed.
   */
  private async handlePeriodStatusChange(
    event: DomainEvent,
    templateType: Extract<NotificationTemplateType, 'PeriodClosed' | 'PeriodReopened'>,
  ): Promise<void> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: event.aggregateId },
    });
    if (!period) return;

    const organizationId = (event.payload['organizationId'] as string) ?? period.organizationId;

    const periodRoles = await this.prisma.rolePermission.findMany({
      where: { permission: { in: ['period:open', 'period:close'] } },
      select: { role: true },
    });
    const roles = [...new Set(periodRoles.map((r) => r.role))];
    if (roles.length === 0) return;

    // Scoped to THIS organization's assignments: a finance_director in another org
    // has no business being told about this org's period changes.
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { organizationId, role: { in: roles } },
      select: { userId: true },
    });

    // Deduplicated: one user holding both period:open and period:close, or the same
    // role in two departments, must not be emailed twice about one close.
    const recipientIds = [...new Set(assignments.map((a) => a.userId))];
    if (recipientIds.length === 0) {
      this.logger.debug(
        `No users hold period permissions in organization ${organizationId} — ` +
          `skipping ${templateType} notification for period ${period.id}`,
      );
      return;
    }

    const periodLabel = `${period.startDate.toISOString().slice(0, 10)} to ${period.endDate
      .toISOString()
      .slice(0, 10)}`;

    for (const recipientUserId of recipientIds) {
      await this.enqueue({
        recipientUserId,
        templateType,
        templateData: {
          periodLabel,
          // Only PeriodReopened carries a reason, and #48 makes it mandatory at the
          // domain layer, so the fallback is defensive rather than expected.
          ...(templateType === 'PeriodReopened'
            ? { reason: (event.payload['reason'] as string) ?? 'No reason provided' }
            : {}),
        },
      });
    }
  }

  private async enqueue(resolution: RecipientResolution): Promise<void> {
    await this.queue.add(NOTIFICATION_JOB, resolution);
  }
}
