// test/integration/contexts/payroll/payroll-run-audit-trail.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../../setup/db-helper';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { ENCRYPTION_SERVICE } from '../../../../src/shared-kernel/encryption/encryption.port';
import { TestEncryptionService } from '../../setup/test-encryption.service';
import { UNIT_OF_WORK } from '../../../../src/shared-kernel/unit-of-work/unit-of-work.port';
import { PrismaUnitOfWork } from '../../../../src/shared-kernel/unit-of-work/prisma-unit-of-work';
import { PrismaPayrollRunRepository } from '../../../../src/contexts/payroll/infrastructure/persistence/prisma-payroll-run.repository';
import { PayrollRun } from '../../../../src/contexts/payroll/domain/aggregates/payroll-run.aggregate';
import { Payslip } from '../../../../src/contexts/payroll/domain/entities/payslip.entity';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { noOpTaxComputation } from '../../../../src/contexts/payroll/domain/value-objects/tax-computation';
import { DomainEventDispatcher } from '../../../../src/shared-kernel/events/domain-event-dispatcher';
import { AuditSubscriber } from '../../../../src/shared-kernel/audit/audit.subscriber';
import { AuditLogService } from '../../../../src/shared-kernel/audit/audit-log.service';
import { OutboxService } from '../../../../src/shared-kernel/outbox/outbox.service';
import { OutboxDispatchService } from '../../../../src/shared-kernel/outbox/outbox-dispatch.service';
import { FailedEventDeliveryService } from '../../../../src/shared-kernel/events/failed-event-delivery.service';
import { EVENT_DELIVERY_RETRY_SCHEDULER } from '../../../../src/shared-kernel/events/event-delivery-retry-scheduler.port';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * TECH_DEBT #52 (items 2 & 3) — proves PayrollRunProcessingStarted and the
 * payslipCount diff survive the REAL pipeline: aggregate -> outbox row in
 * real Postgres -> OutboxDispatchService.dispatchPendingBatch() -> the
 * globally-registered AuditSubscriber -> AuditLogService -> a genuine
 * audit_log_entries row. Deliberately NOT going through BullMQ/HTTP — per
 * #9, dispatchPendingBatch() has zero BullMQ dependency on the success
 * path, which is what makes this reachable at the integration layer at all.
 */
describe('PayrollRun audit trail — event -> outbox -> audit (integration)', () => {
  let prisma: PrismaClient;
  let runRepo: PrismaPayrollRunRepository;
  let outboxService: OutboxService;
  let outboxDispatchService: OutboxDispatchService;
  let orgId: string;
  let periodId: string;
  let employee1Id: string;
  let employee2Id: string;

  beforeAll(async () => {
    prisma = getTestPrismaClient();

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ENCRYPTION_SERVICE, useClass: TestEncryptionService },
        { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
        PrismaPayrollRunRepository,
        DomainEventDispatcher,
        AuditLogService,
        AuditSubscriber,
        OutboxService,
        OutboxDispatchService,
        // Neither is exercised on the happy path (dispatchPendingBatch only
        // calls into these when a subscriber FAILS) — faked rather than
        // guessed at, matching TestEncryptionService's existing precedent.
        { provide: FailedEventDeliveryService, useValue: { recordFailures: jest.fn() } },
        { provide: EVENT_DELIVERY_RETRY_SCHEDULER, useValue: { scheduleRetry: jest.fn() } },
      ],
    }).compile();

    // .init(), not just .compile() — AuditSubscriber.onModuleInit() is what
    // actually calls dispatcher.registerGlobal(...). No existing integration
    // spec needed this before, since none needed a subscriber to self-register.
    await moduleRef.init();

    runRepo = moduleRef.get(PrismaPayrollRunRepository);
    outboxService = moduleRef.get(OutboxService);
    outboxDispatchService = moduleRef.get(OutboxDispatchService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    const org = await prisma.organization.create({ data: { name: 'Test Org' } });
    orgId = org.id;

    const period = await prisma.financialPeriod.create({
      data: {
        organizationId: orgId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });
    periodId = period.id;

    const emp1 = await prisma.employee.create({
      data: { organizationId: orgId, fullName: 'Amaka' },
    });
    employee1Id = emp1.id;
    const emp2 = await prisma.employee.create({
      data: { organizationId: orgId, fullName: 'Tunde' },
    });
    employee2Id = emp2.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildPayslip(employeeId: string, grossMinorUnits = 400000n) {
    return Payslip.generate({
      employeeId,
      salaryStructureSnapshot: { version: 1 },
      lineItems: [
        { kind: 'allowance', label: 'Base Salary', amount: Money.of(grossMinorUnits, 'NGN') },
      ],
      taxComputation: noOpTaxComputation('NGN'),
      currency: 'NGN',
    });
  }

  /** Brings a run to 'approved' through the real repository, exactly the
   * state ProcessPayrollRunHandler receives it in — then discards the
   * in-memory instance (its buffered creation/submit/approve events are
   * irrelevant to what these tests assert) in favor of a fresh reload,
   * which is what actually exercises reconstitute()'s captureBaseline(). */
  async function buildApprovedRun(): Promise<PayrollRun> {
    const run = PayrollRun.create({
      organizationId: orgId,
      periodId,
      runMonth: new Date('2026-08-01'),
      createdById: 'payroll-admin-1',
    });
    run.addPayslip(buildPayslip(employee1Id));
    run.submitForApproval();
    run.approve('finance-director-1');

    await prisma.$transaction((tx) => runRepo.save(run, tx));
    return runRepo.findById(run.id) as Promise<PayrollRun>;
  }

  it('PayrollRunProcessingStarted survives event -> outbox -> audit persistence', async () => {
    const reloaded = await buildApprovedRun();

    reloaded.startProcessing();

    await prisma.$transaction(async (tx) => {
      await runRepo.save(reloaded, tx);
      await outboxService.enqueue(reloaded.pullDomainEvents(), tx);
    });

    const { dispatched, failed } = await outboxDispatchService.dispatchPendingBatch();
    expect(failed).toBe(0);
    expect(dispatched).toBeGreaterThanOrEqual(1);

    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { entityId: reloaded.id, action: 'PayrollRunProcessingStarted' },
    });

    expect(entry.entityType).toBe('PayrollRun');
    expect(entry.organizationId).toBe(orgId);
    // The status transition the run's own persisted row never shows on its
    // own — this run is 'processing' only inside this audit entry's diff,
    // since ProcessPayrollRunHandler always calls complete() in the same
    // transaction in production. Proven directly here regardless.
    expect(entry.oldValue).toEqual({ status: 'approved' });
    expect(entry.newValue).toMatchObject({
      organizationId: orgId,
      changes: { status: { from: 'approved', to: 'processing' } },
    });
  });

  it('payslipCount diff survives event -> outbox -> audit persistence on a second addPayslip()', async () => {
    const run = PayrollRun.create({
      organizationId: orgId,
      periodId,
      runMonth: new Date('2026-08-01'),
      createdById: 'payroll-admin-1',
    });
    run.addPayslip(buildPayslip(employee1Id));
    await prisma.$transaction((tx) => runRepo.save(run, tx));

    // Reload — this is what actually captures the baseline (payslipCount: 1)
    // that the diff below is computed against.
    const reloaded = (await runRepo.findById(run.id)) as PayrollRun;

    reloaded.addPayslip(buildPayslip(employee2Id, 600000n));

    await prisma.$transaction(async (tx) => {
      await runRepo.save(reloaded, tx);
      await outboxService.enqueue(reloaded.pullDomainEvents(), tx);
    });

    const { failed } = await outboxDispatchService.dispatchPendingBatch();
    expect(failed).toBe(0);

    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { entityId: reloaded.id, action: 'PayslipGenerated' },
    });

    expect(entry.oldValue).toEqual({ payslipCount: 1 });
    expect(entry.newValue).toMatchObject({
      changes: { payslipCount: { from: 1, to: 2 } },
    });
  });
});
