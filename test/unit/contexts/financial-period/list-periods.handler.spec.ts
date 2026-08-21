// test/unit/contexts/financial-period/list-periods.handler.spec.ts
import { ListPeriodsHandler } from '../../../../src/contexts/financial-period/application/handlers/list-periods.handler';
import { ListPeriodsQuery } from '../../../../src/contexts/financial-period/application/queries/list-periods.query';
import { GetPeriodByIdHandler } from '../../../../src/contexts/financial-period/application/handlers/get-period-by-id.handler';
import { GetPeriodByIdQuery } from '../../../../src/contexts/financial-period/application/queries/get-period-by-id.query';
import { FinancialPeriod } from '../../../../src/contexts/financial-period/domain/aggregates/financial-period.aggregate';
import { PeriodStatusValue } from '../../../../src/contexts/financial-period/domain/value-objects/period-status';
import { EntityNotFoundError } from '../../../../src/shared-kernel/errors/domain-error';
import { describe, expect, it } from '@jest/globals';

/**
 * Discovery, without which reopen is unusable: only `GET /financial-periods/current`
 * existed, and it matches OPEN_STATUSES only — so a CLOSED period's id, which is
 * exactly what a reopen needs, was unobtainable through the API.
 */
function period(id: string, status: PeriodStatusValue, startDate: string) {
  return FinancialPeriod.reconstitute({
    id,
    organizationId: 'org-1',
    startDate: new Date(startDate),
    endDate: new Date('2026-08-31'),
    status,
    closedById: status === 'closed' ? 'closer-1' : null,
    closedAt: status === 'closed' ? new Date('2026-09-01') : null,
    createdAt: new Date('2026-07-25'),
  });
}

describe('ListPeriodsHandler', () => {
  const build = (rows: FinancialPeriod[]) => {
    const repo = { findManyForOrganization: jest.fn().mockResolvedValue(rows) };
    return { handler: new ListPeriodsHandler(repo as any), repo };
  };

  it('returns plain props, not aggregates', async () => {
    // Callers get a serializable projection; leaking the aggregate would put
    // domain behaviour on the wire and let a controller mutate it.
    const { handler } = build([period('p-1', 'closed', '2026-08-01')]);

    const result = await handler.execute(new ListPeriodsQuery('org-1'));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'p-1', status: 'closed' });
    expect(result[0]).not.toBeInstanceOf(FinancialPeriod);
  });

  it('passes the caller organization and status filter to the repository', async () => {
    const { handler, repo } = build([]);

    await handler.execute(new ListPeriodsQuery('org-1', 'closed'));

    expect(repo.findManyForOrganization).toHaveBeenCalledWith('org-1', 'closed');
  });

  it('passes undefined when no status filter is given, rather than a default', async () => {
    // An accidental default here would silently hide periods — the same class of
    // bug as filtering by 'open' and wondering where the closed ones went.
    const { handler, repo } = build([]);

    await handler.execute(new ListPeriodsQuery('org-1'));

    expect(repo.findManyForOrganization).toHaveBeenCalledWith('org-1', undefined);
  });

  it('returns an empty array rather than throwing when nothing matches', async () => {
    const { handler } = build([]);
    await expect(handler.execute(new ListPeriodsQuery('org-1'))).resolves.toEqual([]);
  });
});

describe('GetPeriodByIdHandler', () => {
  const build = (found: FinancialPeriod | null) => {
    const repo = { findByIdForOrganization: jest.fn().mockResolvedValue(found) };
    return { handler: new GetPeriodByIdHandler(repo as any), repo };
  };

  it('returns the period props when it belongs to the caller organization', async () => {
    const { handler } = build(period('p-1', 'closed', '2026-08-01'));

    const result = await handler.execute(new GetPeriodByIdQuery('p-1', 'org-1'));

    expect(result).toMatchObject({ id: 'p-1', status: 'closed' });
  });

  it('scopes the lookup by organization', async () => {
    const { handler, repo } = build(period('p-1', 'closed', '2026-08-01'));

    await handler.execute(new GetPeriodByIdQuery('p-1', 'org-1'));

    expect(repo.findByIdForOrganization).toHaveBeenCalledWith('p-1', 'org-1');
  });

  it('throws EntityNotFoundError for a period in another organization', async () => {
    // 404, not 403: indistinguishable from "does not exist", so the endpoint
    // cannot enumerate other organizations' period ids (#43's reasoning).
    const { handler } = build(null);

    await expect(handler.execute(new GetPeriodByIdQuery('p-1', 'org-1'))).rejects.toThrow(
      EntityNotFoundError,
    );
  });
});
