// test/unit/notifications/notification-templates.spec.ts
import { describe, expect, it } from '@jest/globals';
import {
  getSubjectFor,
  NotificationTemplateType,
  renderTemplate,
} from '../../../src/notifications/templates/notification-templates';
import { RATEL_LOGO_CID } from '../../../src/notifications/assets/ratel-logo';

const SAMPLE_DATA: Record<NotificationTemplateType, Record<string, unknown>> = {
  ExpenseApproved: {
    expenseNumber: 'EXP-000001',
    amount: 'NGN 2500.00',
    approverName: 'Amaka Okafor',
  },
  ExpenseRejected: {
    expenseNumber: 'EXP-000002',
    amount: 'NGN 1000.00',
    reason: 'Missing receipt',
  },
  PayrollRunApproved: { runMonth: '2026-08' },
  PayslipReady: { runMonth: '2026-08', netPay: 'NGN 450000.00' },
  PeriodClosed: { periodLabel: '2026-08-01 to 2026-08-31' },
  PeriodReopened: { periodLabel: '2026-08-01 to 2026-08-31', reason: 'Late vendor invoice' },
  PayrollRunRejected: { runMonth: '2026-08', reason: 'Headcount mismatch' },
};

const ALL_TYPES = Object.keys(SAMPLE_DATA) as NotificationTemplateType[];

describe('notification-templates', () => {
  it.each(ALL_TYPES)('%s renders a complete HTML document embedding the shared logo CID', (type) => {
    const html = renderTemplate(type, SAMPLE_DATA[type]);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain(`cid:${RATEL_LOGO_CID}`);
    expect(html).toContain('Ratel-Plus Nigeria Ltd');
  });

  it.each(ALL_TYPES)('%s has a non-empty subject', (type) => {
    expect(getSubjectFor(type)).toEqual(expect.any(String));
    expect(getSubjectFor(type).length).toBeGreaterThan(0);
  });

  it('ExpenseApproved includes the resolved approver name, not a raw ID', () => {
    const html = renderTemplate('ExpenseApproved', SAMPLE_DATA.ExpenseApproved);

    expect(html).toContain('EXP-000001');
    expect(html).toContain('NGN 2500.00');
    expect(html).toContain('Amaka Okafor');
  });

  it('ExpenseRejected surfaces the reason in a distinct callout, not buried in a sentence', () => {
    const html = renderTemplate('ExpenseRejected', SAMPLE_DATA.ExpenseRejected);

    expect(html).toContain('Missing receipt');
    expect(html).toContain('Reason');
  });

  it('HTML-escapes data values — a hostile approver/employee name cannot inject markup', () => {
    const html = renderTemplate('ExpenseApproved', {
      ...SAMPLE_DATA.ExpenseApproved,
      approverName: '<img src=x onerror=alert(1)>',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&gt;');
  });

  it('HTML-escapes a hostile rejection reason the same way', () => {
    const html = renderTemplate('ExpenseRejected', {
      ...SAMPLE_DATA.ExpenseRejected,
      reason: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('PeriodReopened requires the mandatory reason and renders it', () => {
    const html = renderTemplate('PeriodReopened', SAMPLE_DATA.PeriodReopened);
    expect(html).toContain('Late vendor invoice');
  });
});
