// prisma/seed/fixtures/financial-periods.ts
import { PrismaClient } from '@prisma/client';

export const SEED_PERIOD_ID = '00000000-0000-4000-8000-000000000002';

export async function seedFinancialPeriods(prisma: PrismaClient, organizationId: string) {
  // Current calendar month, status 'open' — matches what
  // PeriodStatusPort.currentOpenPeriod() needs to find for CreateExpenseHandler
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  const period = await prisma.financialPeriod.upsert({
    where: { id: SEED_PERIOD_ID },
    create: {
      id: SEED_PERIOD_ID,
      organizationId,
      startDate,
      endDate,
      status: 'open',
    },
    update: { status: 'open', closedById: null, closedAt: null },
  });

  console.log(`  ✓ FinancialPeriod: ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)} (open)`);
  return { period };
}