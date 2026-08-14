// prisma/seed/fixtures/employees.ts
import { PrismaClient } from '@prisma/client';
import { SEED_USERS } from './users';

export const SEED_EMPLOYEES = {
  amaka: {
    id: '00000000-0000-4000-8000-000000000021',
    fullName: 'Amaka Chukwu',
    userId: SEED_USERS.employee.id,
  }, // NEW — linked to the seeded 'employee' login
  tunde: { id: '00000000-0000-4000-8000-000000000022', fullName: 'Tunde Bakare', userId: null }, // deliberately left unlinked — demonstrates the "employee with no login" case
} as const;

export async function seedEmployees(prisma: PrismaClient, organizationId: string) {
  for (const employee of Object.values(SEED_EMPLOYEES)) {
    await prisma.employee.upsert({
      where: { id: employee.id },
      create: {
        id: employee.id,
        organizationId,
        fullName: employee.fullName,
        userId: employee.userId,
      },
      update: { fullName: employee.fullName, userId: employee.userId },
    });
  }

  console.log(
    `  ✓ Employees: ${Object.keys(SEED_EMPLOYEES).length} seeded (Amaka linked to a User account, Tunde deliberately not)`,
  );
  return SEED_EMPLOYEES;
}
