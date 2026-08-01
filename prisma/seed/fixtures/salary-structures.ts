// prisma/seed/fixtures/salary-structures.ts
import { PrismaClient } from '@prisma/client';
import { encryptJson } from '../../../src/shared-kernel/encryption/aes-gcm-envelope-crypto';
import { Money } from '../../../src/shared-kernel/money/money.vo';
import {
  SalaryLineItem,
  serializeLineItems,
} from '../../../src/contexts/payroll/domain/value-objects/salary-line-item';

export async function seedSalaryStructures(
  prisma: PrismaClient,
  organizationId: string,
  employeeIds: string[],
  kek: Buffer,
) {
  const lineItems: SalaryLineItem[] = [
    { kind: 'allowance', label: 'Base Salary', amount: Money.of(30_000_00n, 'NGN') },
    { kind: 'allowance', label: 'Housing Allowance', amount: Money.of(10_000_00n, 'NGN') },
    { kind: 'deduction', label: 'Pension (Employee)', amount: Money.of(2_400_00n, 'NGN') },
  ];

  for (const employeeId of employeeIds) {
    const existing = await prisma.salaryStructure.findFirst({
      where: { employeeId, effectiveTo: null },
    });
    if (existing) continue; // idempotent re-run guard

    const encryptedLineItems = encryptJson(kek, serializeLineItems(lineItems));

    await prisma.salaryStructure.create({
      data: {
        organizationId,
        employeeId,
        version: 1,
        effectiveFrom: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        effectiveTo: null,
        encryptedLineItems: Buffer.from(encryptedLineItems),
      },
    });
  }
  console.log(`  ✓ SalaryStructures: seeded for ${employeeIds.length} employees`);
}
