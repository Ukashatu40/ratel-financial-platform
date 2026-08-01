// prisma/seed/fixtures/employees.ts
import { PrismaClient } from '@prisma/client';

export const SEED_EMPLOYEES = {
  amaka: { id: '00000000-0000-4000-8000-000000000021', fullName: 'Amaka Chukwu' },
  tunde: { id: '00000000-0000-4000-8000-000000000022', fullName: 'Tunde Bakare' },
} as const;

export async function seedEmployees(prisma: PrismaClient, organizationId: string) {
  for (const employee of Object.values(SEED_EMPLOYEES)) {
    await prisma.employee.upsert({
      where: { id: employee.id },
      create: { id: employee.id, organizationId, fullName: employee.fullName },
      update: { fullName: employee.fullName },
    });
  }
  console.log(`  ✓ Employees: ${Object.keys(SEED_EMPLOYEES).length} seeded`);
  return SEED_EMPLOYEES;
}
