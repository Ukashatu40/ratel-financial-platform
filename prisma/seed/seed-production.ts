// prisma/seed/seed-production.ts
//
// Production-safe alternative to seed.ts. Deliberately does NOT import any
// of the fixtures that create demo data with fake departments/vendors/
// projects/employees/salary structures or the hardcoded DEV_PASSWORD
// ('DevPassword!23') from fixtures/users.ts — none of that belongs in a
// real deployment. This seeds only the two things a production database
// cannot function without and that have no other way to be created (every
// other table has a real admin-facing API — DepartmentController et al —
// once this seed has created someone who can call it):
//
//   1. The role_permissions matrix (reused as-is from fixtures/role-permissions.ts
//      — it's a permission policy table, not demo data, and is identical in
//      every environment).
//   2. Exactly one real organization + one real finance_director user,
//      sourced entirely from environment variables, so the very first login
//      exists and can use `reference-data:manage` to create real
//      departments/vendors/projects/categories/employees through the API.
//
// Idempotent (upsert throughout) — safe to re-run on every deploy, matching
// how ops/db/harden-audit-log.sh is designed to be re-run unconditionally.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hash } from 'argon2';
import { Logger } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { seedRolePermissions } from './fixtures/role-permissions';

loadEnv();

const logger = new Logger('prisma/seed/seed-production.ts', { timestamp: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => {
  logger.warn(`Database connection terminated: ${err.message}`);
});

const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set — refusing to seed production without it`);
  }
  return value;
}

async function main() {
  console.log('Seeding ratel-financial-platform PRODUCTION data...\n');

  const orgName = process.env.RATEL_ORG_NAME ?? 'Ratel-Plus Nigeria Ltd';
  const adminEmail = requireEnv('RATEL_ADMIN_EMAIL');
  const adminPassword = requireEnv('RATEL_ADMIN_PASSWORD');
  if (adminPassword.length < 12) {
    throw new Error('RATEL_ADMIN_PASSWORD must be at least 12 characters');
  }

  // Fixed, well-known ID only for the organization — this deployment has
  // exactly one, so there's no ambiguity to resolve the way the demo
  // seed's per-entity constants exist to let OTHER fixtures cross-reference
  // them. The admin user gets a real random UUID, not a hardcoded one.
  const orgId = '00000000-0000-4000-8000-000000000001';
  const org = await prisma.organization.upsert({
    where: { id: orgId },
    create: { id: orgId, name: orgName },
    update: { name: orgName },
  });
  console.log(`  ✓ Organization: ${org.name} (${org.id})`);

  await seedRolePermissions(prisma);

  const passwordHash = await hash(adminPassword);
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    create: { id: randomUUID(), email: adminEmail, passwordHash },
    // Deliberately does NOT overwrite passwordHash on re-run — re-running
    // this script (e.g. on every deploy, matching harden-audit-log.sh's
    // posture) must not silently reset a password that's since been
    // changed through the app. Only a fresh insert sets the password.
    update: {},
  });

  await prisma.organizationRoleAssignment.upsert({
    where: { userId_role: { userId: user.id, role: 'finance_director' } },
    create: { userId: user.id, organizationId: org.id, role: 'finance_director' },
    update: {},
  });

  if (existing) {
    console.log(`  ✓ Admin user already existed: ${adminEmail} (password left unchanged)`);
  } else {
    console.log(`  ✓ Admin user created: ${adminEmail} (role: finance_director)`);
    console.log(
      '    Log in with the RATEL_ADMIN_PASSWORD you provided, then rotate it — this script never logs it.',
    );
  }

  console.log('\nProduction seed complete. Use this account to create real departments,');
  console.log('vendors, projects, categories, and employees through the API.');
}

main()
  .catch((err) => {
    console.error('Production seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
