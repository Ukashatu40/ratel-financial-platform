// src/notifications/templates/notification-templates.ts
import Handlebars from 'handlebars';

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
  };
  return subjects[type];
}
