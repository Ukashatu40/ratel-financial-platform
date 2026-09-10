// src/notifications/templates/notification-templates.ts
import Handlebars from 'handlebars';
import { calloutBox, detailsCard, wrapEmailLayout } from './email-layout';

/**
 * The templates that actually exist (TECH_DEBT #32 correction, still true):
 * ExpenseApproved, ExpenseRejected, PayrollRunApproved, PayslipReady,
 * PayrollRunRejected, PeriodClosed, PeriodReopened. Total: 7.
 *
 * Each entry below is `wrapEmailLayout(...)` around a tone/badge/heading and
 * a body built from `detailsCard`/`calloutBox` — the shared letterhead,
 * footer, and typography live in email-layout.ts exactly once, so a new
 * template just plugs into that shell rather than reinventing the HTML
 * document around it. Every `{{var}}` below is Handlebars' default
 * (HTML-escaped) interpolation, deliberately never `{{{var}}}` — these are
 * real user/business data (an approver's name, a rejection reason) landing
 * in an HTML document, not trusted markup.
 */
const templates = {
  ExpenseApproved: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'Your expense {{expenseNumber}} for {{amount}} has been approved.',
      tone: 'success',
      badgeGlyph: '&#10003;',
      heading: 'Expense Approved',
      bodyHtml: `
        <p style="margin:0;">Good news — your expense request has been reviewed and approved.</p>
        ${detailsCard([
          { label: 'Expense Number', value: '{{expenseNumber}}' },
          { label: 'Amount', value: '{{amount}}' },
          { label: 'Approved By', value: '{{approverName}}' },
        ])}
        <p style="margin:0;color:#6B7280;font-size:14px;">This expense will now move forward for processing.</p>
      `,
    }),
  ),

  ExpenseRejected: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'Your expense {{expenseNumber}} for {{amount}} was not approved.',
      tone: 'danger',
      badgeGlyph: '&#10005;',
      heading: 'Expense Rejected',
      bodyHtml: `
        <p style="margin:0 0 20px 0;">Your expense request could not be approved.</p>
        ${detailsCard([
          { label: 'Expense Number', value: '{{expenseNumber}}' },
          { label: 'Amount', value: '{{amount}}' },
        ])}
        ${calloutBox('Reason', '{{reason}}', 'danger')}
        <p style="margin:0;color:#6B7280;font-size:14px;">If you have questions about this decision, please contact your department head or the finance team.</p>
      `,
    }),
  ),

  PayrollRunApproved: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'The payroll run for {{runMonth}} has been approved.',
      tone: 'success',
      badgeGlyph: '&#10003;',
      heading: 'Payroll Run Approved',
      bodyHtml: `
        <p style="margin:0;">The payroll run below has been approved and will now be processed.</p>
        ${detailsCard([
          { label: 'Run Month', value: '{{runMonth}}' },
          { label: 'Status', value: 'Approved' },
        ])}
        <p style="margin:0;color:#6B7280;font-size:14px;">Payslips will be generated and made available to employees shortly.</p>
      `,
    }),
  ),

  PayslipReady: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'Your pay for {{runMonth}} has been processed — net pay {{netPay}}.',
      tone: 'info',
      badgeGlyph: '&#10003;',
      heading: 'Your Payslip is Ready',
      bodyHtml: `
        <p style="margin:0;">Your pay for the period below has been processed.</p>
        ${detailsCard([
          { label: 'Pay Period', value: '{{runMonth}}' },
          { label: 'Net Pay', value: '{{netPay}}' },
        ])}
        <p style="margin:0;color:#6B7280;font-size:14px;">Please keep this for your records. If you have questions about your pay, contact the payroll team.</p>
      `,
    }),
  ),

  /**
   * Notifies users who hold period management roles that a period was closed.
   * The finance lead who closed it also needs to know what their action caused
   * on the records side, and other period managers need to know the period is
   * no longer open for new expenses or payroll mutations.
   */
  PeriodClosed: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'The financial period {{periodLabel}} has been closed.',
      tone: 'info',
      badgeGlyph: 'i',
      heading: 'Financial Period Closed',
      bodyHtml: `
        <p style="margin:0;">The financial period below has been closed.</p>
        ${detailsCard([
          { label: 'Period', value: '{{periodLabel}}' },
          { label: 'Status', value: 'Closed' },
        ])}
        <p style="margin:0;color:#6B7280;font-size:14px;">No further expenses or payroll changes can be made against this period until it is reopened.</p>
      `,
    }),
  ),

  /**
   * Includes the required reason (#48's invariant), which is exactly what
   * an auditor or finance lead wants to know when they're notified about a
   * reopen. The reason is mandatory at the domain layer, so the template
   * never needs a fallback.
   */
  PeriodReopened: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'The financial period {{periodLabel}} has been reopened.',
      tone: 'success',
      badgeGlyph: '&#10003;',
      heading: 'Financial Period Reopened',
      bodyHtml: `
        <p style="margin:0 0 20px 0;">The financial period below has been reopened.</p>
        ${detailsCard([{ label: 'Period', value: '{{periodLabel}}' }])}
        ${calloutBox('Reason', '{{reason}}', 'info')}
        <p style="margin:0;color:#6B7280;font-size:14px;">Expenses and payroll mutations against this period are permitted again.</p>
      `,
    }),
  ),

  /**
   * Mirrors ExpenseRejected, which already notifies the requester. The
   * asymmetry that existed before (#32): a payroll admin whose run was
   * rejected learned about it only by looking.
   */
  PayrollRunRejected: Handlebars.compile(
    wrapEmailLayout({
      preheader: 'The payroll run for {{runMonth}} was rejected.',
      tone: 'danger',
      badgeGlyph: '&#10005;',
      heading: 'Payroll Run Rejected',
      bodyHtml: `
        <p style="margin:0 0 20px 0;">The payroll run below was rejected.</p>
        ${detailsCard([{ label: 'Run Month', value: '{{runMonth}}' }])}
        ${calloutBox('Reason', '{{reason}}', 'danger')}
        <p style="margin:0;color:#6B7280;font-size:14px;">Please review and resubmit.</p>
      `,
    }),
  ),
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
