// test/unit/contexts/financial-period/close-period.handler.spec.ts
import { ClosePeriodHandler } from '../../../../src/contexts/financial-period/application/handlers/close-period.handler';
import { ClosePeriodCommand } from '../../../../src/contexts/financial-period/application/commands/close-period.command';
import { FinancialPeriod } from '../../../../src/contexts/financial-period/domain/aggregates/financial-period.aggregate';
import { PeriodStatusValue } from '../../../../src/contexts/financial-period/domain/value-objects/period-status';
import {
  EntityNotFoundError,
  InvalidStateTransitionError,
} from '../../../../src/shared-kernel/errors/domain-error';
import { describe, expect, it } from '@jest/globals';

/**
 * Regression coverage for #49. `ClosePeriodHandler` resolved its period with
 * `findById(cmd.periodId)` and never compared `cmd.organizationId` to anything,
 * even though the command has always carried it — so any caller holding
 * `period:close` could close ANOTHER organization's period. The handler had no
 * unit spec at all, which is why a decorative constructor argument survived
 * unnoticed; these tests exist so it can't come back.
 */
function periodInStatus(status: PeriodStatusValue, organizationId = 'org-1') {
  // Reconstituted, not created-then-mutated: `create()` records PeriodOpened, and
  // this must simulate an aggregate loaded from the database with an empty event
  // list, or the enqueue assertions would be reading that event too.
  return FinancialPeriod.reconstitute({
    id: 'period-1',
    organizationId,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
    status,
    closedById: null,
    closedAt: null,
    createdAt: new Date('2026-07-25'),
  });
}

function buildDeps(overrides: { period?: FinancialPeriod | null } = {}) {
  // 'key' in overrides, never ??: an explicit `period: null` (the not-found and
  // cross-organization cases) must apply rather than fall back to a default
  // (critical convention #4).
  const period = 'period' in overrides ? overrides.period : periodInStatus('open');

  const repo = {
    findById: jest.fn().mockResolvedValue(period),
    findByIdForOrganization: jest.fn().mockResolvedValue(period),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const uow = { transaction: jest.fn((fn) => fn({})) };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

  const handler = new ClosePeriodHandler(repo as any, uow as any, outbox as any);
  return { handler, repo, uow, outbox, period };
}

const command = (organizationId = 'org-1') =>
  new ClosePeriodCommand(organizationId, 'period-1', 'closer-1');

describe('ClosePeriodHandler', () => {
  it('closes an open period and saves it', async () => {
    const { handler, repo, period } = buildDeps();

    await handler.execute(command());

    expect(period!.status).toBe('closed');
    expect(period!.isOpen()).toBe(false);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('enqueues PeriodClosed through the outbox, inside the transaction', async () => {
    // Non-negotiable per CLAUDE.md's event pipeline: the enqueue must happen in
    // the SAME transaction as the state change, never after it.
    const { handler, uow, outbox } = buildDeps();

    await handler.execute(command());

    expect(uow.transaction).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);

    const events = outbox.enqueue.mock.calls[0][0] as { type: string }[];
    expect(events.map((e) => e.type)).toEqual(['PeriodClosed']);
  });

  it('scopes the lookup by organization, not by id alone', async () => {
    // The #49 fix itself. Asserted as BOTH the scoped call happening and the
    // unscoped one not happening — checking only the former would still pass if
    // someone reinstated `findById` alongside it.
    const { handler, repo } = buildDeps();

    await handler.execute(command('org-1'));

    expect(repo.findByIdForOrganization).toHaveBeenCalledWith(
      'period-1',
      'org-1',
      expect.anything(),
    );
    expect(repo.findById).not.toHaveBeenCalled();
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

  it('refuses to close a period that is already closed, and writes nothing', async () => {
    const { handler, repo, outbox } = buildDeps({ period: periodInStatus('closed') });

    await expect(handler.execute(command())).rejects.toThrow(InvalidStateTransitionError);

    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
