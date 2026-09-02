// test/unit/contexts/payroll/salary-structure.handlers.spec.ts
import {
  CreateSalaryStructureHandler,
  CreateSalaryStructureVersionHandler,
  GetActiveSalaryStructureHandler,
} from '../../../../src/contexts/payroll/application/salary-structure/salary-structure.handlers';
import {
  CreateSalaryStructureCommand,
  CreateSalaryStructureVersionCommand,
} from '../../../../src/contexts/payroll/application/salary-structure/salary-structure.commands';
import { GetActiveSalaryStructureQuery } from '../../../../src/contexts/payroll/application/salary-structure/salary-structure.queries';
import {
  SalaryStructure,
  SalaryStructureAlreadyExistsError,
} from '../../../../src/contexts/payroll/domain/aggregates/salary-structure.aggregate';
import { EntityNotFoundError } from '../../../../src/shared-kernel/errors/domain-error';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { describe, expect, it } from '@jest/globals';

// Minimal fake — passes the object straight through as `tx`. Every handler
// under test only uses `tx` to hand to repo/outbox calls, which are
// separately faked below, so no real transaction semantics are needed here.
function fakeUow() {
  return { transaction: (work: (tx: unknown) => Promise<unknown>) => work({}) };
}

function fakeOutbox() {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
}

function buildActiveStructure(overrides: { organizationId?: string; employeeId?: string } = {}) {
  const structure = SalaryStructure.createInitialVersion({
    organizationId: overrides.organizationId ?? 'org-1',
    employeeId: overrides.employeeId ?? 'emp-1',
    effectiveFrom: new Date('2026-01-01'),
    baseSalaryLineItems: [{ kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') }],
  });
  structure.pullDomainEvents(); // creation event is irrelevant to these handler tests
  return structure;
}

describe('CreateSalaryStructureHandler', () => {
  it('creates a version-1 structure when the employee has none yet', async () => {
    const repo = {
      findActiveForEmployee: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      saveNextVersion: jest.fn(),
    };
    const outbox = fakeOutbox();
    const handler = new CreateSalaryStructureHandler(repo as any, fakeUow() as any, outbox as any);

    const result = await handler.execute(
      new CreateSalaryStructureCommand('org-1', 'emp-1', new Date('2026-01-01'), [
        { kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') },
      ]),
    );

    expect(result.id).toBeDefined();
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const [events] = outbox.enqueue.mock.calls[0];
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('SalaryStructureCreated');
  });

  it('rejects when the employee already has an active structure', async () => {
    const repo = {
      findActiveForEmployee: jest.fn().mockResolvedValue(buildActiveStructure()),
      save: jest.fn(),
      saveNextVersion: jest.fn(),
    };
    const handler = new CreateSalaryStructureHandler(
      repo as any,
      fakeUow() as any,
      fakeOutbox() as any,
    );

    await expect(
      handler.execute(
        new CreateSalaryStructureCommand('org-1', 'emp-1', new Date('2026-01-01'), []),
      ),
    ).rejects.toThrow(SalaryStructureAlreadyExistsError);
  });
});

describe('CreateSalaryStructureVersionHandler', () => {
  it('creates the next version, closes the previous one, and saves both via saveNextVersion()', async () => {
    const previous = buildActiveStructure();
    const repo = {
      findActiveForEmployee: jest.fn().mockResolvedValue(previous),
      save: jest.fn(),
      saveNextVersion: jest.fn().mockResolvedValue(undefined),
    };
    const outbox = fakeOutbox();
    const handler = new CreateSalaryStructureVersionHandler(
      repo as any,
      fakeUow() as any,
      outbox as any,
    );

    const result = await handler.execute(
      new CreateSalaryStructureVersionCommand('org-1', 'emp-1', new Date('2026-08-01'), [
        { kind: 'allowance', label: 'Raised', amount: Money.of(350000n, 'NGN') },
      ]),
    );

    expect(result.id).toBeDefined();
    expect(result.id).not.toBe(previous.id);

    // saveNextVersion() called with previous ALREADY closed — this is the
    // TECH_DEBT #56 fix's core assertion: previous carries a real effectiveTo
    // by the time persistence sees it, rather than persistence deriving it.
    expect(repo.saveNextVersion).toHaveBeenCalledTimes(1);
    const [savedPrevious, savedNext] = repo.saveNextVersion.mock.calls[0];
    expect(savedPrevious.toProps().effectiveTo).toEqual(new Date('2026-08-01'));
    expect(savedNext.id).toBe(result.id);

    // Both instances' events merged into ONE enqueue call — mirrors
    // ProcessPayrollRunHandler's startProcessing()+complete() pattern.
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const [events] = outbox.enqueue.mock.calls[0];
    expect(events.map((e: { type: string }) => e.type).sort()).toEqual([
      'SalaryStructureClosed',
      'SalaryStructureVersionCreated',
    ]);
  });

  it('throws EntityNotFoundError when the employee has no active structure', async () => {
    const repo = {
      findActiveForEmployee: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      saveNextVersion: jest.fn(),
    };
    const handler = new CreateSalaryStructureVersionHandler(
      repo as any,
      fakeUow() as any,
      fakeOutbox() as any,
    );

    await expect(
      handler.execute(
        new CreateSalaryStructureVersionCommand('org-1', 'emp-1', new Date('2026-08-01'), []),
      ),
    ).rejects.toThrow(EntityNotFoundError);
  });

  it('throws EntityNotFoundError (not a leak) when the active structure belongs to another organization', async () => {
    const foreignStructure = buildActiveStructure({ organizationId: 'org-OTHER' });
    const repo = {
      findActiveForEmployee: jest.fn().mockResolvedValue(foreignStructure),
      save: jest.fn(),
      saveNextVersion: jest.fn(),
    };
    const handler = new CreateSalaryStructureVersionHandler(
      repo as any,
      fakeUow() as any,
      fakeOutbox() as any,
    );

    await expect(
      handler.execute(
        new CreateSalaryStructureVersionCommand('org-1', 'emp-1', new Date('2026-08-01'), []),
      ),
    ).rejects.toThrow(EntityNotFoundError);
  });
});

describe('GetActiveSalaryStructureHandler', () => {
  it('returns the active structure projected to a plain view', async () => {
    const structure = buildActiveStructure();
    const repo = { findActiveForEmployee: jest.fn().mockResolvedValue(structure) };
    const handler = new GetActiveSalaryStructureHandler(repo as any);

    const result = await handler.execute(new GetActiveSalaryStructureQuery('emp-1', 'org-1'));

    expect(result).toEqual({
      id: structure.id,
      employeeId: 'emp-1',
      version: 1,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      baseSalaryLineItems: [
        { kind: 'allowance', label: 'Base', amount: { minorUnits: '300000', currency: 'NGN' } },
      ],
    });
  });

  it('throws EntityNotFoundError when no active structure exists', async () => {
    const repo = { findActiveForEmployee: jest.fn().mockResolvedValue(null) };
    const handler = new GetActiveSalaryStructureHandler(repo as any);

    await expect(
      handler.execute(new GetActiveSalaryStructureQuery('emp-1', 'org-1')),
    ).rejects.toThrow(EntityNotFoundError);
  });

  it("throws EntityNotFoundError (not a leak) for another organization's structure", async () => {
    const foreignStructure = buildActiveStructure({ organizationId: 'org-OTHER' });
    const repo = { findActiveForEmployee: jest.fn().mockResolvedValue(foreignStructure) };
    const handler = new GetActiveSalaryStructureHandler(repo as any);

    await expect(
      handler.execute(new GetActiveSalaryStructureQuery('emp-1', 'org-1')),
    ).rejects.toThrow(EntityNotFoundError);
  });
});
