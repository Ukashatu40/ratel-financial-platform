// prisma/seed/fixtures/users.ts
import { PrismaClient } from '@prisma/client';

// Fixed IDs so other fixtures/tests can reference them by constant rather
// than re-querying — deliberate for dev/seed data only, never a pattern
// used for real user creation (that goes through the auth module).
export const SEED_USERS = {
  employee: { id: '00000000-0000-4000-8000-000000000011', email: 'employee@ratel-plus.com' },
  accountant: { id: '00000000-0000-4000-8000-000000000012', email: 'accountant@ratel-plus.com' },
  departmentHead: { id: '00000000-0000-4000-8000-000000000013', email: 'depthead@ratel-plus.com' },
  financeDirector: { id: '00000000-0000-4000-8000-000000000014', email: 'financedirector@ratel-plus.com' },
} as const;

export async function seedUsers(prisma: PrismaClient) {
  for (const user of Object.values(SEED_USERS)) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: { id: user.id, email: user.email },
      update: { email: user.email },
    });
  }
  console.log(`  ✓ Users: ${Object.keys(SEED_USERS).length} seeded`);
  return SEED_USERS;
}