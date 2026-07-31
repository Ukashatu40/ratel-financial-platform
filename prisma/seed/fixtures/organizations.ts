// prisma/seed/fixtures/organizations.ts
import { PrismaClient } from '@prisma/client';

export const SEED_ORG_ID = '00000000-0000-4000-8000-000000000001';

export async function seedOrganizations(prisma: PrismaClient) {
  const org = await prisma.organization.upsert({
    where: { id: SEED_ORG_ID },
    create: { id: SEED_ORG_ID, name: 'Ratel-Plus Nigeria Ltd' },
    update: { name: 'Ratel-Plus Nigeria Ltd' },
  });

  console.log(`  ✓ Organization: ${org.name} (${org.id})`);
  return { org };
}