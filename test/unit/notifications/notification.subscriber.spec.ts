// test/unit/notifications/notification.subscriber.spec.ts
import { NotificationSubscriber } from '../../../src/notifications/notification.subscriber';
import { DomainEvent } from '../../../src/shared-kernel/events/domain-event';
import { describe, expect, it, beforeEach } from '@jest/globals';

/**
 * Covers the three subscriptions added closing TECH_DEBT #32. The subscriber had no
 * test of any kind before this.
 *
 * `PayrollRunRejected` is unit-tested rather than e2e-tested for a stated reason:
 * there is no payroll e2e spec in this repo at all, and standing one up needs
 * employees, salary structures and field encryption — a fixture materially larger
 * than this piece. The period handlers ARE covered e2e, so the queue-and-template
 * wiring is proven end to end there; what these tests add is recipient resolution
 * per event type.
 */
const event = (type: string, payload: Record<string, unknown> = {}): DomainEvent => ({
  type,
  aggregateType: type.startsWith('Period') ? 'FinancialPeriod' : 'PayrollRun',
  aggregateId: 'aggregate-1',
  occurredAt: new Date('2026-08-25T00:00:00.000Z'),
  payload: { organizationId: 'org-1', ...payload },
});

describe('NotificationSubscriber — #32 additions', () => {
  let queue: { add: jest.Mock };
  let prisma: any;
  let subscriber: NotificationSubscriber;
  let registrations: Map<string, (e: DomainEvent) => Promise<void>>;

  beforeEach(() => {
    registrations = new Map();
    const dispatcher = {
      register: jest.fn((type: string, handler: (e: DomainEvent) => Promise<void>) => {
        registrations.set(type, handler);
      }),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      payrollRun: { findFirst: jest.fn() },
      financialPeriod: { findFirst: jest.fn() },
      rolePermission: { findMany: jest.fn() },
      userRoleAssignment: { findMany: jest.fn() },
    };

    subscriber = new NotificationSubscriber(dispatcher as any, prisma, queue as any);
    subscriber.onModuleInit();
  });

  const dispatch = (e: DomainEvent) => registrations.get(e.type)!(e);
  const enqueued = () => queue.add.mock.calls.map((c) => c[1]);

  it('registers for the three new event types alongside the original three', () => {
    expect([...registrations.keys()].sort()).toEqual(
      [
        'ExpenseApproved',
        'ExpenseRejected',
        'PayrollRunApproved',
        'PayrollRunRejected',
        'PeriodClosed',
        'PeriodReopened',
      ].sort(),
    );
  });

  describe('PayrollRunRejected', () => {
    it('notifies the run creator, with the rejection reason', () => {
      // Mirrors ExpenseRejected: the person who needs to know is whoever created the
      // thing that was rejected, not the approver who rejected it.
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        createdById: 'payroll-admin-1',
        runMonth: new Date('2026-08-01T00:00:00.000Z'),
      });

      return dispatch(event('PayrollRunRejected', { reason: 'Headcount mismatch' })).then(() => {
        expect(enqueued()).toEqual([
          {
            recipientUserId: 'payroll-admin-1',
            templateType: 'PayrollRunRejected',
            templateData: { runMonth: '2026-08', reason: 'Headcount mismatch' },
          },
        ]);
      });
    });

    it('enqueues nothing when the run no longer exists', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await dispatch(event('PayrollRunRejected', { reason: 'x' }));

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('PeriodClosed / PeriodReopened', () => {
    const period = {
      id: 'period-1',
      organizationId: 'org-1',
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-31T00:00:00.000Z'),
    };

    beforeEach(() => {
      prisma.financialPeriod.findFirst.mockResolvedValue(period);
      prisma.rolePermission.findMany.mockResolvedValue([
        { role: 'finance_director' },
        { role: 'finance_director' }, // holds both period:open and period:close
        { role: 'accountant' },
      ]);
      prisma.userRoleAssignment.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
    });

    it('notifies every user holding a period permission, once each', async () => {
      await dispatch(event('PeriodClosed'));

      expect(enqueued()).toEqual([
        {
          recipientUserId: 'user-1',
          templateType: 'PeriodClosed',
          templateData: { periodLabel: '2026-08-01 to 2026-08-31' },
        },
        {
          recipientUserId: 'user-2',
          templateType: 'PeriodClosed',
          templateData: { periodLabel: '2026-08-01 to 2026-08-31' },
        },
      ]);
    });

    it('deduplicates roles before querying assignments', async () => {
      // finance_director appears twice above (it holds both period permissions). A
      // duplicated role in the `in` clause would risk duplicate assignment rows and
      // so duplicate emails about a single close.
      await dispatch(event('PeriodClosed'));

      const where = prisma.userRoleAssignment.findMany.mock.calls[0][0].where;
      expect(where.role.in).toEqual(['finance_director', 'accountant']);
      expect(where.organizationId).toBe('org-1');
    });

    it('deduplicates recipients, so one user is not emailed twice', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-1' }, // same user, two departments
      ]);

      await dispatch(event('PeriodClosed'));

      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('includes the reason for a reopen but not for a close', async () => {
      await dispatch(event('PeriodReopened', { reason: 'Late vendor invoice' }));

      expect(enqueued()[0].templateData).toEqual({
        periodLabel: '2026-08-01 to 2026-08-31',
        reason: 'Late vendor invoice',
      });

      queue.add.mockClear();
      await dispatch(event('PeriodClosed'));
      expect(enqueued()[0].templateData).not.toHaveProperty('reason');
    });

    it('enqueues nothing when no user holds a period permission', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);

      await dispatch(event('PeriodClosed'));

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues nothing when no role is granted a period permission at all', async () => {
      // Guards against the `in: []` query, which would match every assignment rather
      // than none — the failure mode being that everyone gets emailed.
      prisma.rolePermission.findMany.mockResolvedValue([]);

      await dispatch(event('PeriodClosed'));

      expect(prisma.userRoleAssignment.findMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
