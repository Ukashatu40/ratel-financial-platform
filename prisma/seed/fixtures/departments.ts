// prisma/seed/fixtures/departments.ts
import { PrismaClient } from '@prisma/client';

export const SEED_DEPARTMENT_ID = '00000000-0000-4000-8000-000000000003';

export async function seedDepartments(prisma: PrismaClient, organizationId: string) {
  const department = await prisma.department.upsert({
    where: { organizationId_name: { organizationId, name: 'Engineering' } },
    create: { id: SEED_DEPARTMENT_ID, organizationId, name: 'Engineering' },
    update: {},
  });

  console.log(`  ✓ Department: ${department.name} (${department.id})`);
  return { department };
}