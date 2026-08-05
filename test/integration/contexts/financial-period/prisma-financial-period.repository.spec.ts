// test/integration/contexts/financial-period/prisma-financial-period.repository.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../../setup/db-helper';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { PrismaFinancialPeriodRepository } from '../../../../src/contexts/financial-period/infrastructure/persistence/prisma-financial-period.repository';
import { FinancialPeriod } from '../../../../src/contexts/financial-period/domain/aggregates/financial-period.aggregate';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('PrismaFinancialPeriodRepository (integration)', () => {
  let prisma: PrismaClient;
  let repo: PrismaFinancialPeriodRepository;
  let orgId: string;

  beforeAll(async () => {
    prisma = getTestPrismaClient();

    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: PrismaService, useValue: prisma }, PrismaFinancialPeriodRepository],
    }).compile();

    repo = moduleRef.get(PrismaFinancialPeriodRepository);
  });

  let closerUserId: string;

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const org = await prisma.organization.create({ data: { name: 'Test Org' } });
    orgId = org.id;

    const closer = await prisma.user.create({
      data: { email: 'closer@test.local', passwordHash: 'not-a-real-hash-test-only' },
    });
    closerUserId = closer.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists and reconstructs a period with all fields intact', async () => {
    const period = FinancialPeriod.create({
      organizationId: orgId,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
    });

    await prisma.$transaction(async (tx) => {
      await repo.save(period, tx);
    });

    const found = await repo.findById(period.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(period.id);
    expect(found!.organizationId).toBe(orgId);
    expect(found!.status).toBe('open');
    expect(found!.startDate.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('findCurrentOpen() returns the open period for an org, ignoring closed ones', async () => {
    const closed = FinancialPeriod.create({
      organizationId: orgId,
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-31'),
    });
    closed.close(closerUserId);

    const open = FinancialPeriod.create({
      organizationId: orgId,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
    });

    await prisma.$transaction(async (tx) => {
      await repo.save(closed, tx);
      await repo.save(open, tx);
    });

    const found = await repo.findCurrentOpen(orgId);
    expect(found?.id).toBe(open.id);
  });

  it('findCurrentOpen() returns null when no period is open', async () => {
    const closed = FinancialPeriod.create({
      organizationId: orgId,
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-31'),
    });
    closed.close(closerUserId);

    await prisma.$transaction(async (tx) => {
      await repo.save(closed, tx);
    });

    const found = await repo.findCurrentOpen(orgId);
    expect(found).toBeNull();
  });

  it('persists a status change made after initial save (close -> DB reflects closed)', async () => {
    const period = FinancialPeriod.create({
      organizationId: orgId,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
    });

    await prisma.$transaction((tx) => repo.save(period, tx));

    period.close(closerUserId);
    await prisma.$transaction((tx) => repo.save(period, tx));

    const found = await repo.findById(period.id);
    expect(found!.status).toBe('closed');
  });
});
