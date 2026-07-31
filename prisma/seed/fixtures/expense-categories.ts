// prisma/seed/fixtures/expense-categories.ts
import { PrismaClient } from '@prisma/client';

export const SEED_CATEGORY_ID = '00000000-0000-4000-8000-000000000006';

export async function seedExpenseCategories(prisma: PrismaClient, organizationId: string) {
  const category = await prisma.expenseCategory.upsert({
    where: { organizationId_name: { organizationId, name: 'Cloud Services' } },
    create: { id: SEED_CATEGORY_ID, organizationId, name: 'Cloud Services' },
    update: {},
  });

  console.log(`  ✓ ExpenseCategory: ${category.name} (${category.id})`);
  return { category };
}