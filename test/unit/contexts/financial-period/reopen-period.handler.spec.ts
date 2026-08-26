// test/unit/contexts/financial-period/reopen-period.handler.spec.ts
import { ReopenPeriodHandler } from '../../../../src/contexts/financial-period/application/handlers/reopen-period.handler';
import { ReopenPeriodCommand } from '../../../../src/contexts/financial-period/application/commands/reopen-period.command';
import {
  FinancialPeriod,
  PeriodReopenReasonRequiredError,
} from '../../../../src/contexts/financial-period/domain/aggregates/financial-period.aggregate';
import { PeriodStatusValue } from '../../../../src/contexts/financial-period/domain/value-objects/period-status';
import {
  EntityNotFoundError,
  InvalidStateTransitionError,
} from '../../../../src/shared-kernel/errors/domain-error';
import { describe, expect, it } from '@jest/globals';

/**
 * Closing a financial period is enforced by NINE call sites across Expense and
 * Payroll (submit/approve/reject/cancel, add-payslip/submit/approve/reject), all
 * throwing PeriodClosedError once the period is not open. That thoroughness is
 * what made the missing reopen path serious: an expense in `pending_approval`
 * when its period closed could neither be approved NOR rejected, so it was
 * stranded permanently with no route back through the API.
 *
 * The aggregate's `reopen()` was already implemented and unit-tested; only the
 * application path to it was absent. These tests cover that path.
 */

/**
 * Reconstituted rather than created-then-closed, deliberately: `create()` and
 * `close()` record their own events, and this must simulate an aggregate loaded
 * from the database, whose event list starts empty. Otherwise the enqueue
 * assertions below would be reading PeriodOpened/PeriodClosed too.
 */
function periodInStatus(status: PeriodStatusValue, organizationId = 'org-1') {
  return FinancialPeriod.reconstitute({
    id: 'period-1',
    organizationId,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
    status,
    closedById: status === 'closed' ? 'closer-1' : null,
    closedAt: status === 'closed' ? new Date('2026-09-01') : null,
    createdAt: new Date('2026-07-25'),
  });
}

function buildDeps(overrides: { period?: FinancialPeriod | null } = {}) {
  // 'key' in overrides, never ??: an explicit `period: null` (the not-found and
  // cross-organization cases) must apply rather than fall back to a default
  // (critical convention #4).
  const period = 'period' in overrides ? overrides.period : periodInStatus('closed');

  const repo = {
    findByIdForOrganization: jest.fn().mockResolvedValue(period),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const uow = { transaction: jest.fn((fn) => fn({})) };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

  const handler = new ReopenPeriodHandler(repo as any, uow as any, outbox as any);
  return { handler, repo, uow, outbox, period };
}

const command = (overrides: { reason?: string; organizationId?: string } = {}) =>
  new ReopenPeriodCommand(
    'organizationId' in overrides ? overrides.organizationId! : 'org-1',
    'period-1',
    'reopener-1',
    'reason' in overrides ? overrides.reason! : 'Late vendor invoice arrived after close',
  );

describe('ReopenPeriodHandler', () => {
  it('reopens a closed period and saves it', async () => {
    const { handler, repo, period } = buildDeps();

    await handler.execute(command());

    expect(period!.status).toBe('reopened');
    expect(period!.isOpen()).toBe(true); // the whole point: mutations are possible again
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('enqueues PeriodReopened through the outbox, inside the transaction', async () => {
    // Non-negotiable per CLAUDE.md's event pipeline: the enqueue must happen in
    // the SAME transaction as the state change, never after it.
    const { handler, uow, outbox } = buildDeps();

    await handler.execute(command());

    expect(uow.transaction).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);

    const events = outbox.enqueue.mock.calls[0][0] as { type: string }[];
    expect(events.map((e) => e.type)).toEqual(['PeriodReopened']);
  });

  it('carries the supplied reason on the event payload', async () => {
    // This is what makes the reason auditable for free: AuditSubscriber is
    // registered globally and already lifts `payload['reason']` into the audit
    // entry, so no audit-side code is needed for this to be recorded.
    const { handler, outbox } = buildDeps();

    await handler.execute(command({ reason: 'Reversal of duplicated vendor payment' }));

    const [event] = outbox.enqueue.mock.calls[0][0] as { payload: Record<string, unknown> }[];
    expect(event.payload).toMatchObject({
      organizationId: 'org-1',
      reopenedById: 'reopener-1',
      reason: 'Reversal of duplicated vendor payment',
    });
  });

  it('scopes the lookup by organization, not by id alone', async () => {
    // ClosePeriodHandler resolves by id only and never compares the period's
    // organization to the caller's, so a period id from another organization is
    // actionable there. This handler must not repeat that.
    const { handler, repo } = buildDeps();

    await handler.execute(command({ organizationId: 'org-1' }));

    expect(repo.findByIdForOrganization).toHaveBeenCalledWith('period-1', 'org-1', expect.anything());
  });

  it('throws EntityNotFoundError when no period matches, and writes nothing', async () => {
    // Also the cross-organization case: the org-scoped lookup returns null, so
    // "not yours" is indistinguishable from "does not exist" and the endpoint
    // cannot be used to probe which period ids exist elsewhere (#43's reasoning).
    const { handler, repo, outbox } = buildDeps({ period: null });

    await expect(handler.execute(command())).rejects.toThrow(EntityNotFoundError);

    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('refuses to reopen a period that is already open, and writes nothing', async () => {
    const { handler, repo, outbox } = buildDeps({ period: periodInStatus('open') });

    await expect(handler.execute(command())).rejects.toThrow(InvalidStateTransitionError);

    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('refuses to reopen a period that is already reopened', async () => {
    const { handler, outbox } = buildDeps({ period: periodInStatus('reopened') });

    await expect(handler.execute(command())).rejects.toThrow(InvalidStateTransitionError);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a blank reason at the domain boundary, and writes nothing', async () => {
    // The DTO validates this too, but the aggregate owns the invariant: a
    // "required" reason that accepts whitespace is not required. Asserted here
    // because the handler must not persist a period reopened for no stated cause.
    const { handler, repo, outbox } = buildDeps();

    await expect(handler.execute(command({ reason: '   ' }))).rejects.toThrow(
      PeriodReopenReasonRequiredError,
    );

    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
