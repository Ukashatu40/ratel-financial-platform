// test/integration/contexts/payroll/prisma-salary-structure.repository.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../../setup/db-helper';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { ENCRYPTION_SERVICE } from '../../../../src/shared-kernel/encryption/encryption.port';
import { TestEncryptionService } from '../../setup/test-encryption.service';
import { PrismaSalaryStructureRepository } from '../../../../src/contexts/payroll/infrastructure/persistence/prisma-salary-structure.repository';
import { SalaryStructure } from '../../../../src/contexts/payroll/domain/aggregates/salary-structure.aggregate';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('PrismaSalaryStructureRepository (integration)', () => {
  let prisma: PrismaClient;
  let repo: PrismaSalaryStructureRepository;
  let orgId: string;
  let employeeId: string;

  beforeAll(async () => {
    prisma = getTestPrismaClient();

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ENCRYPTION_SERVICE, useClass: TestEncryptionService },
        PrismaSalaryStructureRepository,
      ],
    }).compile();

    repo = moduleRef.get(PrismaSalaryStructureRepository);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    const org = await prisma.organization.create({ data: { name: 'Test Org' } });
    orgId = org.id;

    const employee = await prisma.employee.create({
      data: { organizationId: orgId, fullName: 'Test Employee' },
    });
    employeeId = employee.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('findActiveForEmployee() returns null when no structure exists', async () => {
    const found = await repo.findActiveForEmployee(employeeId);
    expect(found).toBeNull();
  });

  it('persists and reconstructs a salary structure with real Money instances after decryption', async () => {
    const structure = SalaryStructure.createInitialVersion({
      organizationId: orgId,
      employeeId,
      effectiveFrom: new Date('2026-08-01'),
      baseSalaryLineItems: [
        { kind: 'allowance', label: 'Base Salary', amount: Money.of(300000n, 'NGN') },
        { kind: 'allowance', label: 'Housing', amount: Money.of(100000n, 'NGN') },
        { kind: 'deduction', label: 'Pension', amount: Money.of(24000n, 'NGN') },
      ],
    });

    await prisma.$transaction((tx) => repo.save(structure, tx));

    const found = await repo.findActiveForEmployee(employeeId);
    expect(found).not.toBeNull();

    const lineItems = found!.baseSalaryLineItems;
    expect(lineItems).toHaveLength(3);

    // The critical assertion: these must be REAL Money instances with
    // working methods after the decrypt->deserialize round trip, not just
    // plain objects that happen to look right — this is exactly the class
    // of bug we caught and fixed earlier (Money.toJSON/fromJSON piece).
    const base = lineItems.find((li) => li.label === 'Base Salary')!;
    expect(base.amount.minorUnits).toBe(300000n);
    expect(base.amount.add(Money.of(1n, 'NGN')).minorUnits).toBe(300001n); // proves it's a real Money, not a plain object
  });

  it('encrypted_line_items column does NOT contain readable plaintext', async () => {
    const structure = SalaryStructure.createInitialVersion({
      organizationId: orgId,
      employeeId,
      effectiveFrom: new Date('2026-08-01'),
      baseSalaryLineItems: [
        {
          kind: 'allowance',
          label: 'VERY_DISTINCTIVE_LABEL_FOR_LEAK_CHECK',
          amount: Money.of(300000n, 'NGN'),
        },
      ],
    });

    await prisma.$transaction((tx) => repo.save(structure, tx));

    const rawRow = await prisma.salaryStructure.findFirstOrThrow({ where: { employeeId } });
    const rawBytes = Buffer.from(rawRow.encryptedLineItems).toString('utf8');

    // If encryption is genuinely happening, the distinctive plaintext label
    // must NOT appear anywhere in the raw column bytes — this is a direct,
    // concrete test of "is this actually encrypted" rather than trusting
    // that encryptJson() was called just because no error was thrown.
    expect(rawBytes).not.toContain('VERY_DISTINCTIVE_LABEL_FOR_LEAK_CHECK');
  });

  describe('versioning', () => {
    it('createNextVersion + save() closes out the previous active version', async () => {
      const v1 = SalaryStructure.createInitialVersion({
        organizationId: orgId,
        employeeId,
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') },
        ],
      });
      await prisma.$transaction((tx) => repo.save(v1, tx));

      const v2 = SalaryStructure.createNextVersion(v1, {
        effectiveFrom: new Date('2026-08-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Raised Base', amount: Money.of(350000n, 'NGN') },
        ],
      });
      await prisma.$transaction((tx) => repo.save(v2, tx));

      // findActiveForEmployee should now return v2, not v1
      const active = await repo.findActiveForEmployee(employeeId);
      expect(active!.toProps().version).toBe(2);
      expect(active!.baseSalaryLineItems[0].label).toBe('Raised Base');

      // v1's row should now have a non-null effectiveTo in the raw DB
      const v1Row = await prisma.salaryStructure.findFirstOrThrow({
        where: { employeeId, version: 1 },
      });
      expect(v1Row.effectiveTo).not.toBeNull();
    });

    it('preserves v1 unchanged in the database after v2 is saved', async () => {
      const v1 = SalaryStructure.createInitialVersion({
        organizationId: orgId,
        employeeId,
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Original Base', amount: Money.of(300000n, 'NGN') },
        ],
      });
      await prisma.$transaction((tx) => repo.save(v1, tx));

      const v2 = SalaryStructure.createNextVersion(v1, {
        effectiveFrom: new Date('2026-08-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'New Base', amount: Money.of(350000n, 'NGN') },
        ],
      });
      await prisma.$transaction((tx) => repo.save(v2, tx));

      const v1RowCount = await prisma.salaryStructure.count({ where: { employeeId, version: 1 } });
      expect(v1RowCount).toBe(1); // v1 still exists as its own row, not overwritten
    });
  });
});
