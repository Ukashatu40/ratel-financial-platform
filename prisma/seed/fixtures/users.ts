// prisma/seed/fixtures/users.ts
import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';

// Fixed IDs so other fixtures/tests can reference them by constant rather
// than re-querying — deliberate for dev/seed data only, never a pattern
// used for real user creation (that goes through the auth module).
export const SEED_USERS = {
  employee: { id: '00000000-0000-4000-8000-000000000011', email: 'employee@ratel-plus.com' },
  accountant: { id: '00000000-0000-4000-8000-000000000012', email: 'accountant@ratel-plus.com' },
  departmentHead: { id: '00000000-0000-4000-8000-000000000013', email: 'depthead@ratel-plus.com' },
  financeDirector: {
    id: '00000000-0000-4000-8000-000000000014',
    email: 'financedirector@ratel-plus.com',
  },
  payrollAdmin: {
    id: '00000000-0000-4000-8000-000000000015',
    email: 'payrolladmin@ratel-plus.com',
  },
} as const;

// Dev-only fixed password for every seeded user — never used outside local
// seeding, and printed to the seed log so it's easy to find, not hidden.
const DEV_PASSWORD = 'DevPassword!23';

export async function seedUsers(
  prisma: PrismaClient,
  organizationId: string,
  departmentId: string,
) {
  const passwordHash = await hash(DEV_PASSWORD);

  for (const user of Object.values(SEED_USERS)) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: { id: user.id, email: user.email, passwordHash },
      update: { email: user.email },
    });
  }

  const assignments: Array<{ userId: string; role: string; departmentId: string | null }> = [
    { userId: SEED_USERS.employee.id, role: 'employee', departmentId: null },
    { userId: SEED_USERS.accountant.id, role: 'accountant', departmentId: null },
    { userId: SEED_USERS.departmentHead.id, role: 'department_head', departmentId },
    { userId: SEED_USERS.financeDirector.id, role: 'finance_director', departmentId: null },
    { userId: SEED_USERS.payrollAdmin.id, role: 'payroll_admin', departmentId: null },
  ];

  for (const a of assignments) {
    // TECH_DEBT #14 — real upsert() now works here. The original manual
    // find-then-create existed because @@unique([userId, role, departmentId])
    // couldn't reliably match a null-departmentId row (Postgres treats every
    // NULL as distinct in a unique index). Neither new table has a nullable
    // column in its unique key, so that limitation no longer applies.
    if (a.departmentId) {
      await prisma.departmentRoleAssignment.upsert({
        where: {
          userId_role_departmentId: {
            userId: a.userId,
            role: a.role as any,
            departmentId: a.departmentId,
          },
        },
        create: {
          userId: a.userId,
          organizationId,
          role: a.role as any,
          departmentId: a.departmentId,
        },
        update: {},
      });
    } else {
      await prisma.organizationRoleAssignment.upsert({
        where: { userId_role: { userId: a.userId, role: a.role as any } },
        create: { userId: a.userId, organizationId, role: a.role as any },
        update: {},
      });
    }
  }

  console.log(`  ✓ Users: ${Object.keys(SEED_USERS).length} seeded (password: ${DEV_PASSWORD})`);
  return SEED_USERS;
}
