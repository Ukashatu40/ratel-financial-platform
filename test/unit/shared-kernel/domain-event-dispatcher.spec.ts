// test/unit/shared-kernel/domain-event-dispatcher.spec.ts
import {
  DomainEventDispatcher,
  DuplicateSubscriberNameError,
  UnknownSubscriberError,
} from '../../../src/shared-kernel/events/domain-event-dispatcher';
import { DomainEvent } from '../../../src/shared-kernel/events/domain-event';
import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

const event = (type = 'ExpenseApproved'): DomainEvent => ({
  type,
  aggregateType: 'Expense',
  aggregateId: 'exp-1',
  occurredAt: new Date('2026-08-19T00:00:00.000Z'),
  payload: { organizationId: 'org-1' },
});

describe('DomainEventDispatcher', () => {
  let dispatcher: DomainEventDispatcher;

  beforeAll(() => {
    // Failure paths log at error level by design; silence it so a passing run
    // isn't full of expected noise.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    dispatcher = new DomainEventDispatcher();
  });

  describe('dispatch', () => {
    it('reports no failures when every subscriber succeeds', async () => {
      dispatcher.register('ExpenseApproved', async () => undefined, 'A');
      dispatcher.register('ExpenseApproved', async () => undefined, 'B');

      const result = await dispatcher.dispatch(event());

      expect(result.invoked).toBe(2);
      expect(result.failures).toEqual([]);
    });

    it('still runs every other subscriber when one throws', async () => {
      // The pre-existing allSettled guarantee, which had no test before this.
      const ran: string[] = [];
      dispatcher.register('ExpenseApproved', async () => {
        ran.push('first');
      }, 'First');
      dispatcher.register('ExpenseApproved', async () => {
        throw new Error('boom');
      }, 'Exploding');
      dispatcher.register('ExpenseApproved', async () => {
        ran.push('third');
      }, 'Third');

      await dispatcher.dispatch(event());

      expect(ran).toEqual(['first', 'third']);
    });

    it('returns the failing subscriber by NAME, not by array index', async () => {
      // The whole point of TECH_DEBT #9's slice 1: `Handler 2` was unusable
      // both as a diagnostic and as a retry key.
      dispatcher.register('ExpenseApproved', async () => undefined, 'Healthy');
      dispatcher.register('ExpenseApproved', async () => {
        throw new Error('db unavailable');
      }, 'AuditSubscriber');

      const result = await dispatcher.dispatch(event());

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].subscriberName).toBe('AuditSubscriber');
      expect((result.failures[0].error as Error).message).toBe('db unavailable');
    });

    it('reports every failure when several subscribers fail', async () => {
      dispatcher.register('ExpenseApproved', async () => {
        throw new Error('one');
      }, 'One');
      dispatcher.register('ExpenseApproved', async () => {
        throw new Error('two');
      }, 'Two');

      const result = await dispatcher.dispatch(event());

      expect(result.failures.map((f) => f.subscriberName).sort()).toEqual(['One', 'Two']);
    });

    it('delivers to global subscribers regardless of event type', async () => {
      const seen: string[] = [];
      dispatcher.registerGlobal(async (e) => {
        seen.push(e.type);
      }, 'AuditSubscriber');

      await dispatcher.dispatch(event('ExpenseApproved'));
      await dispatcher.dispatch(event('PayrollRunApproved'));

      expect(seen).toEqual(['ExpenseApproved', 'PayrollRunApproved']);
    });

    it('reports zero invoked when nothing is registered for the type', async () => {
      const result = await dispatcher.dispatch(event('NobodyCares'));

      expect(result).toEqual({ invoked: 0, failures: [] });
    });
  });

  describe('registration guards', () => {
    it('rejects a duplicate subscriber name for the same event type', async () => {
      dispatcher.register('ExpenseApproved', async () => undefined, 'Dupe');

      expect(() =>
        dispatcher.register('ExpenseApproved', async () => undefined, 'Dupe'),
      ).toThrow(DuplicateSubscriberNameError);
    });

    it('rejects a name that collides with a global subscriber', () => {
      dispatcher.registerGlobal(async () => undefined, 'AuditSubscriber');

      expect(() =>
        dispatcher.register('ExpenseApproved', async () => undefined, 'AuditSubscriber'),
      ).toThrow(DuplicateSubscriberNameError);
    });

    it('rejects registering the same global name twice', () => {
      dispatcher.registerGlobal(async () => undefined, 'AuditSubscriber');

      expect(() => dispatcher.registerGlobal(async () => undefined, 'AuditSubscriber')).toThrow(
        DuplicateSubscriberNameError,
      );
    });

    it('ALLOWS one name across different event types', async () => {
      // ExpenseReadModelProjector and NotificationSubscriber both do this — one
      // subscriber that cares about several events. Redelivery resolves the
      // handler per event type, so there is no ambiguity to guard against.
      expect(() => {
        dispatcher.register('ExpenseApproved', async () => undefined, 'Projector');
        dispatcher.register('ExpenseRejected', async () => undefined, 'Projector');
      }).not.toThrow();
    });
  });

  describe('dispatchTo — the retry primitive', () => {
    it('invokes ONLY the named subscriber', async () => {
      // Per-subscriber rather than per-event is the point: re-running the
      // subscribers that already succeeded would re-send notification email.
      const ran: string[] = [];
      dispatcher.register('ExpenseApproved', async () => {
        ran.push('NotificationSubscriber');
      }, 'NotificationSubscriber');
      dispatcher.register('ExpenseApproved', async () => {
        ran.push('AuditSubscriber');
      }, 'AuditSubscriber');

      await dispatcher.dispatchTo('AuditSubscriber', event());

      expect(ran).toEqual(['AuditSubscriber']);
    });

    it('can reach a global subscriber', async () => {
      let ran = false;
      dispatcher.registerGlobal(async () => {
        ran = true;
      }, 'AuditSubscriber');

      await dispatcher.dispatchTo('AuditSubscriber', event());

      expect(ran).toBe(true);
    });

    it('throws UnknownSubscriberError for a name that is not registered', async () => {
      // A subscriber renamed or removed since the failure was recorded must fail
      // loudly — silently no-op'ing would mark the delivery recovered when the
      // event was never actually processed.
      dispatcher.register('ExpenseApproved', async () => undefined, 'Present');

      await expect(dispatcher.dispatchTo('LongGone', event())).rejects.toThrow(
        UnknownSubscriberError,
      );
    });

    it('throws for a subscriber that exists but not for THIS event type', async () => {
      dispatcher.register('ExpenseRejected', async () => undefined, 'OnlyRejections');

      await expect(
        dispatcher.dispatchTo('OnlyRejections', event('ExpenseApproved')),
      ).rejects.toThrow(UnknownSubscriberError);
    });

    it('propagates the subscriber error instead of swallowing it', async () => {
      // The caller (BullMQ) drives retry off this throw — swallowing here would
      // silently disable the whole retry mechanism.
      dispatcher.register('ExpenseApproved', async () => {
        throw new Error('still broken');
      }, 'AuditSubscriber');

      await expect(dispatcher.dispatchTo('AuditSubscriber', event())).rejects.toThrow(
        'still broken',
      );
    });
  });
});
