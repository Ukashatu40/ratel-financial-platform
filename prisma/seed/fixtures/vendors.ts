// prisma/seed/fixtures/vendors.ts
import { PrismaClient } from '@prisma/client';

export const SEED_VENDOR_ID = '00000000-0000-4000-8000-000000000004';

export async function seedVendors(prisma: PrismaClient, organizationId: string) {
  const existing = await prisma.vendor.findFirst({ where: { id: SEED_VENDOR_ID } });
  const vendor =
    existing ??
    (await prisma.vendor.create({
      data: { id: SEED_VENDOR_ID, organizationId, name: 'Amazon Web Services' },
    }));

  console.log(`  ✓ Vendor: ${vendor.name} (${vendor.id})`);
  return { vendor };
}