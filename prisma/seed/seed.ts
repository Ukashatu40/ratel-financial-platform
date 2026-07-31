// prisma/seed/seed.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedOrganizations } from './fixtures/organizations';
import { seedUsers } from './fixtures/users';
import { seedFinancialPeriods } from './fixtures/financial-periods';
import { seedDepartments } from './fixtures/departments';
import { seedVendors } from './fixtures/vendors';
import { seedProjects } from './fixtures/projects';
import { seedExpenseCategories } from './fixtures/expense-categories';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL 
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter })


async function main() {
  console.log('Seeding ratel-financial-platform dev data...\n');

  const { org } = await seedOrganizations(prisma);
  const users = await seedUsers(prisma);
  await seedFinancialPeriods(prisma, org.id);
  await seedDepartments(prisma, org.id);
  await seedVendors(prisma, org.id);
  await seedProjects(prisma, org.id);
  await seedExpenseCategories(prisma, org.id);

  console.log('\nSeed complete. Reference IDs:');
  console.log(`  organizationId: 00000000-0000-4000-8000-000000000001`);
  console.log(`  departmentId:   00000000-0000-4000-8000-000000000003`);
  console.log(`  vendorId:       00000000-0000-4000-8000-000000000004`);
  console.log(`  projectId:      00000000-0000-4000-8000-000000000005`);
  console.log(`  categoryId:     00000000-0000-4000-8000-000000000006`);
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