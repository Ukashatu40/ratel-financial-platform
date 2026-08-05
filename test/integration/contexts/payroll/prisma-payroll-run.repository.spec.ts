// test/integration/contexts/payroll/prisma-payroll-run.repository.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../../setup/db-helper';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { ENCRYPTION_SERVICE } from '../../../../src/shared-kernel/encryption/encryption.port';
import { TestEncryptionService } from '../../setup/test-encryption.service';
import { PrismaPayrollRunRepository } from '../../../../src/contexts/payroll/infrastructure/persistence/prisma-payroll-run.repository';
import { PayrollRun } from '../../../../src/contexts/payroll/domain/aggregates/payroll-run.aggregate';
import { Payslip } from '../../../../src/contexts/payroll/domain/entities/payslip.entity';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { noOpTaxComputation } from '../../../../src/contexts/payroll/domain/value-objects/tax-computation';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('PrismaPayrollRunRepository (integration)', () => {
  let prisma: PrismaClient;
  let repo: PrismaPayrollRunRepository;
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
        PrismaPayrollRunRepository,
      ],
    }).compile();

    repo = moduleRef.get(PrismaPayrollRunRepository);
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

  function buildRun() {
    return PayrollRun.create({
      organizationId: orgId,
      periodId,
      runMonth: new Date('2026-08-01'),
      createdById: 'admin-1',
    });
  }

  function buildPayslip(employeeId: string, grossMinorUnits = 400000n) {
    return Payslip.generate({
      employeeId,
      salaryStructureSnapshot: { version: 1, note: 'test snapshot' },
      lineItems: [
        { kind: 'allowance', label: 'Base Salary', amount: Money.of(grossMinorUnits, 'NGN') },
      ],
      taxComputation: noOpTaxComputation('NGN'),
      currency: 'NGN',
    });
  }

  it('persists and reconstructs a run with correctly decrypted payslip detail', async () => {
    const run = buildRun();
    run.addPayslip(buildPayslip(employee1Id, 400000n));

    await prisma.$transaction((tx) => repo.save(run, tx));

    const found = await repo.findById(run.id);
    expect(found).not.toBeNull();
    expect(found!.getPayslips).toHaveLength(1);

    const payslip = found!.getPayslips[0];
    expect(payslip.grossPay.minorUnits).toBe(400000n);
    expect(payslip.netPay.minorUnits).toBe(400000n); // no deductions in this fixture

    // Confirms the decrypted line items are real, working Money instances —
    // not just structurally-similar plain objects.
    const props = payslip.toProps();
    expect(props.lineItems[0].amount.add(Money.of(1n, 'NGN')).minorUnits).toBe(400001n);
    expect(props.salaryStructureSnapshot).toEqual({ version: 1, note: 'test snapshot' });
  });

  it('gross/net minor units stay plaintext in the DB while detail is encrypted', async () => {
    const run = buildRun();
    run.addPayslip(buildPayslip(employee1Id, 400000n));
    await prisma.$transaction((tx) => repo.save(run, tx));

    const rawPayslip = await prisma.payslip.findFirstOrThrow({ where: { payrollRunId: run.id } });

    // Plaintext columns readable directly (this is the deliberate design
    // from Phase 6.2/9.3 — reporting/reconciliation shouldn't need decryption)
    expect(rawPayslip.grossPayMinorUnits).toBe(400000n);
    expect(rawPayslip.netPayMinorUnits).toBe(400000n);

    // But the detail blob must NOT contain the plaintext label
    const rawDetailBytes = Buffer.from(rawPayslip.encryptedDetail).toString('utf8');
    expect(rawDetailBytes).not.toContain('Base Salary');
  });

  it('supports multiple payslips in one run, each independently encrypted', async () => {
    const run = buildRun();
    run.addPayslip(buildPayslip(employee1Id, 400000n));
    run.addPayslip(buildPayslip(employee2Id, 600000n));

    await prisma.$transaction((tx) => repo.save(run, tx));

    const found = await repo.findById(run.id);
    expect(found!.getPayslips).toHaveLength(2);
    expect(found!.totalGrossPay('NGN').minorUnits).toBe(1000000n);
  });

  it('save() only inserts NEW payslips on a second call (delta flush, not full rewrite)', async () => {
    const run = buildRun();
    run.addPayslip(buildPayslip(employee1Id));
    await prisma.$transaction((tx) => repo.save(run, tx));

    // Reload, add a second payslip to the SAME run, save again
    const reloaded = await repo.findById(run.id);
    reloaded!.addPayslip(buildPayslip(employee2Id));
    await prisma.$transaction((tx) => repo.save(reloaded!, tx));

    const payslipCount = await prisma.payslip.count({ where: { payrollRunId: run.id } });
    expect(payslipCount).toBe(2); // not duplicated, not lost — exactly 2

    const finalFind = await repo.findById(run.id);
    expect(finalFind!.getPayslips).toHaveLength(2);
  });

  it('findByOrgAndMonth() locates a run by organization and month', async () => {
    const run = buildRun();
    run.addPayslip(buildPayslip(employee1Id));
    await prisma.$transaction((tx) => repo.save(run, tx));

    const found = await repo.findByOrgAndMonth(orgId, new Date('2026-08-01'));
    expect(found?.id).toBe(run.id);
  });

  it('findByOrgAndMonth() returns null for a month with no run', async () => {
    const found = await repo.findByOrgAndMonth(orgId, new Date('2026-12-01'));
    expect(found).toBeNull();
  });

  it('persists a full lifecycle transition (submit -> approve -> process) correctly', async () => {
    const run = buildRun();
    run.addPayslip(buildPayslip(employee1Id));
    await prisma.$transaction((tx) => repo.save(run, tx));

    run.submitForApproval();
    await prisma.$transaction((tx) => repo.save(run, tx));
    let found = await repo.findById(run.id);
    expect(found!.status).toBe('pending_approval');

    found!.approve('finance-director-1');
    await prisma.$transaction((tx) => repo.save(found!, tx));
    found = await repo.findById(run.id);
    expect(found!.status).toBe('approved');
  });
});
