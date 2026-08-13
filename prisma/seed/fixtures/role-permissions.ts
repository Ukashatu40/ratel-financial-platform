// prisma/seed/fixtures/role-permissions.ts
import { PrismaClient } from '@prisma/client';

/**
 * Literal instantiation of the Phase 9.1 permission matrix. Editing this
 * list and re-running the seed is how permissions change — no code deploy
 * needed for a policy adjustment (e.g. raising the accountant's approval
 * threshold-adjacent permission), matching the original design intent.
 */
const MATRIX: Array<{ role: string; permission: string; scope: string }> = [
  // Employee
  { role: 'employee', permission: 'expense:create', scope: 'own' },

  // Accountant
  { role: 'accountant', permission: 'expense:create', scope: 'organization' },
  { role: 'accountant', permission: 'expense:adjust', scope: 'organization' },

  // Department Head
  { role: 'department_head', permission: 'expense:approve', scope: 'department' },

  // Finance Director
  { role: 'finance_director', permission: 'expense:create', scope: 'organization' },
  { role: 'finance_director', permission: 'expense:approve', scope: 'organization' },
  { role: 'finance_director', permission: 'expense:adjust', scope: 'organization' },
  { role: 'finance_director', permission: 'period:close', scope: 'organization' },
  { role: 'finance_director', permission: 'period:open', scope: 'organization' },
  { role: 'finance_director', permission: 'payroll:approve', scope: 'organization' },

  // Payroll Admin
  { role: 'payroll_admin', permission: 'payroll:create', scope: 'organization' },
  { role: 'payroll_admin', permission: 'payroll:view_sensitive', scope: 'organization' },

  // Auditor
  { role: 'auditor', permission: 'audit:view', scope: 'organization' },

  // Expense Viewing
  { role: 'employee', permission: 'expense:view', scope: 'own' },
  { role: 'department_head', permission: 'expense:view', scope: 'department' },
  { role: 'accountant', permission: 'expense:view', scope: 'organization' },
  { role: 'finance_director', permission: 'expense:view', scope: 'organization' },

  // Report Viewing
  { role: 'department_head', permission: 'report:view', scope: 'department' },
  { role: 'accountant', permission: 'report:view', scope: 'organization' },
  { role: 'finance_director', permission: 'report:view', scope: 'organization' },

  { role: 'accountant', permission: 'reference-data:manage', scope: 'organization' },
  { role: 'finance_director', permission: 'reference-data:manage', scope: 'organization' },

  { role: 'accountant', permission: 'notification:manage', scope: 'organization' },
  { role: 'finance_director', permission: 'notification:manage', scope: 'organization' },
];

export async function seedRolePermissions(prisma: PrismaClient) {
  for (const entry of MATRIX) {
    await prisma.rolePermission.upsert({
      where: { role_permission: { role: entry.role as any, permission: entry.permission } },
      create: { role: entry.role as any, permission: entry.permission, scope: entry.scope as any },
      update: { scope: entry.scope as any },
    });
  }
  console.log(`  ✓ RolePermissions: ${MATRIX.length} entries seeded`);
}
