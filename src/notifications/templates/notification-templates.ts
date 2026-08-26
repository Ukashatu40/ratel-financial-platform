// src/notifications/templates/notification-templates.ts
import Handlebars from 'handlebars';

/**
 * The templates that actually exist (TECH_DEBT #32 correction):
 * 4 existed before this update (ExpenseApproved, ExpenseRejected, PayrollRunApproved,
 * PayslipReady — the entry saying "3" had silently missed PayslipReady). Adding 3 more:
 * PayrollRunRejected, PeriodClosed, PeriodReopened. Total: 7.
 */
const templates = {
  ExpenseApproved: Handlebars.compile(`
    <h2>Your expense has been approved</h2>
    <p>Expense {{expenseNumber}} for {{amount}} was approved by {{approverName}}.</p>
  `),
  ExpenseRejected: Handlebars.compile(`
    <h2>Your expense was rejected</h2>
    <p>Expense {{expenseNumber}} for {{amount}} was rejected.</p>
    <p><strong>Reason:</strong> {{reason}}</p>
  `),
  PayrollRunApproved: Handlebars.compile(`
    <h2>Payroll run approved</h2>
    <p>The payroll run for {{runMonth}} has been approved and will be processed.</p>
  `),
  PayslipReady: Handlebars.compile(`
    <h2>Your payslip is ready</h2>
    <p>Your pay for {{runMonth}} has been processed.</p>
    <p><strong>Net pay:</strong> {{netPay}}</p>
  `),
  /**
   * Notifies users who hold period management roles that a period was closed.
   * The finance lead who closed it also needs to know what their action caused
   * on the records side, and other period managers need to know the period is
   * no longer open for new expenses or payroll mutations.
   */
  PeriodClosed: Handlebars.compile(`
    <h2>Financial period closed</h2>
    <p>The financial period {{periodLabel}} has been closed.</p>
    <p>No further expenses or payroll changes can be made against this period
    until it is reopened.</p>
  `),
  /**
   * Includes the required reason (#48's invariant), which is exactly what
   * an auditor or finance lead wants to know when they're notified about a
   * reopen. The reason is mandatory at the domain layer, so the template
   * never needs a fallback.
   */
  PeriodReopened: Handlebars.compile(`
    <h2>Financial period reopened</h2>
    <p>The financial period {{periodLabel}} has been reopened.</p>
    <p><strong>Reason:</strong> {{reason}}</p>
    <p>Expenses and payroll mutations against this period are permitted again.</p>
  `),
  /**
   * Mirrors ExpenseRejected, which already notifies the requester. The
   * asymmetry that existed before (#32): a payroll admin whose run was
   * rejected learned about it only by looking.
   */
  PayrollRunRejected: Handlebars.compile(`
    <h2>Payroll run rejected</h2>
    <p>The payroll run for {{runMonth}} was rejected.</p>
    <p><strong>Reason:</strong> {{reason}}</p>
    <p>Please review and resubmit.</p>
  `),
};

export type NotificationTemplateType = keyof typeof templates;

export function renderTemplate(
  type: NotificationTemplateType,
  data: Record<string, unknown>,
): string {
  return templates[type](data);
}

export function getSubjectFor(type: NotificationTemplateType): string {
  const subjects: Record<NotificationTemplateType, string> = {
    ExpenseApproved: 'Your expense was approved',
    ExpenseRejected: 'Your expense was rejected',
    PayrollRunApproved: 'Payroll run approved',
    PayslipReady: 'Your payslip is ready',
    PeriodClosed: 'Financial period closed',
    PeriodReopened: 'Financial period reopened',
    PayrollRunRejected: 'Payroll run rejected',
  };
  return subjects[type];
}

