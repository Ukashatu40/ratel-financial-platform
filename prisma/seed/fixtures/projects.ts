// prisma/seed/fixtures/projects.ts
import { PrismaClient } from '@prisma/client';

export const SEED_PROJECT_ID = '00000000-0000-4000-8000-000000000005';

export async function seedProjects(prisma: PrismaClient, organizationId: string) {
  const existing = await prisma.project.findFirst({ where: { id: SEED_PROJECT_ID } });
  const project =
    existing ??
    (await prisma.project.create({
      data: { id: SEED_PROJECT_ID, organizationId, name: 'Financial Platform Rebuild' },
    }));

  console.log(`  ✓ Project: ${project.name} (${project.id})`);
  return { project };
}