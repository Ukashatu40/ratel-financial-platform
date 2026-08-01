// prisma/seed/seed.ts
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { loadKekFromBase64 } from '../../src/shared-kernel/encryption/aes-gcm-envelope-crypto';
import { seedOrganizations } from './fixtures/organizations';
import { seedUsers } from './fixtures/users';
import { seedFinancialPeriods } from './fixtures/financial-periods';
import { seedDepartments } from './fixtures/departments';
import { seedVendors } from './fixtures/vendors';
import { seedProjects } from './fixtures/projects';
import { seedExpenseCategories } from './fixtures/expense-categories';
import { seedEmployees } from './fixtures/employees';
import { seedSalaryStructures } from './fixtures/salary-structures';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

loadEnv(); // ts-node doesn't auto-load .env the way Nest's bootstrap does — needed here explicitly

// 1. Instantiate a proper connection pool instance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding ratel-financial-platform dev data...\n');

  const masterKeyRaw = process.env.FIELD_ENCRYPTION_MASTER_KEY;
  if (!masterKeyRaw) {
    throw new Error('FIELD_ENCRYPTION_MASTER_KEY not set — check .env before seeding Payroll data');
  }
  const kek = loadKekFromBase64(masterKeyRaw);

  const { org } = await seedOrganizations(prisma);
  const users = await seedUsers(prisma);
  await seedFinancialPeriods(prisma, org.id);
  await seedDepartments(prisma, org.id);
  await seedVendors(prisma, org.id);
  await seedProjects(prisma, org.id);
  await seedExpenseCategories(prisma, org.id);

  const employees = await seedEmployees(prisma, org.id);
  await seedSalaryStructures(
    prisma,
    org.id,
    Object.values(employees).map((e) => e.id),
    kek,
  );

  console.log('\nSeed complete. Reference IDs:');
  console.log(`  organizationId: 00000000-0000-4000-8000-000000000001`);
  console.log(`  departmentId:   00000000-0000-4000-8000-000000000003`);
  console.log(`  vendorId:       00000000-0000-4000-8000-000000000004`);
  console.log(`  projectId:      00000000-0000-4000-8000-000000000005`);
  console.log(`  categoryId:     00000000-0000-4000-8000-000000000006`);
  console.log(`  employees:      ${JSON.stringify(employees, null, 2)}`);
  console.log(`  users:          ${JSON.stringify(users, null, 2)}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
