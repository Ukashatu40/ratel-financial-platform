// test/e2e/audit-log-verify.e2e.spec.ts
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from 'argon2';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';

describe('Audit Log (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let orgId: string;
  let deptId: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();

    const org = await prisma.organization.create({ data: { name: 'E2E Test Org' } });
    orgId = org.id;

    // Required for expense creation to succeed — confirmed by
    // expense-lifecycle.e2e.spec.ts, which seeds the identical open period
    // before any expense POST. This spec previously omitted it, which is
    // what produced the 409 Conflict.
    await prisma.financialPeriod.create({
      data: {
        organizationId: orgId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });

    const dept = await prisma.department.create({
      data: { organizationId: orgId, name: 'Engineering' },
    });
    deptId = dept.id;

    const category = await prisma.expenseCategory.create({
      data: { organizationId: orgId, name: 'Cloud' },
    });
    categoryId = category.id;

    const passwordHash = await hash('E2ePassword!23');

    const employee = await prisma.user.create({
      data: { email: 'employee@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: { userId: employee.id, organizationId: orgId, role: 'employee', departmentId: null },
    });

    const deptHead = await prisma.user.create({
      data: { email: 'depthead@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: deptHead.id,
        organizationId: orgId,
        role: 'department_head',
        departmentId: deptId,
      },
    });

    // audit:view lives only on `auditor`, per role-permissions.ts — no other
    // role in the matrix carries it, which is also what makes the 403 test
    // below a meaningful negative case rather than an accident of a missing
    // grant.
    const auditor = await prisma.user.create({
      data: { email: 'auditor@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: { userId: auditor.id, organizationId: orgId, role: 'auditor', departmentId: null },
    });

    await prisma.rolePermission.createMany({
      data: [
        { role: 'employee', permission: 'expense:create', scope: 'own' },
        { role: 'department_head', permission: 'expense:approve', scope: 'department' },
        { role: 'auditor', permission: 'audit:view', scope: 'organization' },
      ],
    });
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'E2ePassword!23' })
      .expect(201);
    return res.body.accessToken;
  }

  describe('GET /audit-entries/verify', () => {
    it('rejects a role without audit:view with a specific 403, not the generic message', async () => {
      const employeeToken = await loginAs('employee@e2e.test');

      const res = await request(server)
        .get('/api/v1/audit-entries/verify')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);

      // Per the PermissionGuard fix — confirms this endpoint went through
      // the same specific-message path as everything else, not a stray
      // generic ForbiddenException some other guard produced.
      expect(res.body.detail).toContain('audit:view');
    });

    it('verifies a real chain produced by ordinary application use — create, submit, approve an expense', async () => {
      const employeeToken = await loginAs('employee@e2e.test');
      const deptHeadToken = await loginAs('depthead@e2e.test');
      const auditorToken = await loginAs('auditor@e2e.test');

      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          sourceType: 'employee',
          departmentId: deptId,
          categoryId,
          amountMinorUnits: 250000,
          currency: 'NGN',
          expenseDate: '2026-08-01',
        })
        .expect(201);

      const expenseId = createRes.body.id;

      await request(server)
        .post(`/api/v1/expenses/${expenseId}/submit`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);

      await request(server)
        .post(`/api/v1/expenses/${expenseId}/approve`)
        .set('Authorization', `Bearer ${deptHeadToken}`)
        .expect(201);

      // Outbox dispatch runs every 3s — same wait pattern used throughout
      // this build's e2e suite for any test depending on async event
      // propagation (audit writes, notifications, read-model projection).
      await new Promise((r) => setTimeout(r, 4000));

      const res = await request(server)
        .get('/api/v1/audit-entries/verify')
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.entriesChecked).toBeGreaterThanOrEqual(3); // Drafted, SubmittedForApproval, Approved
      expect(res.body.firstMismatchId).toBeNull();
      expect(res.body.caveat).toContain('cannot prove no entries are missing');
    });

    it('reports invalid when a row is altered directly in the database, bypassing AuditLogService', async () => {
      const employeeToken = await loginAs('employee@e2e.test');
      const auditorToken = await loginAs('auditor@e2e.test');

      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          sourceType: 'employee',
          departmentId: deptId,
          categoryId,
          amountMinorUnits: 100000,
          currency: 'NGN',
          expenseDate: '2026-08-01',
        })
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      // Reach around the application entirely — the exact threat model the
      // hash chain exists to catch (a direct DB edit, not an API call).
      const prisma = getE2eDbClient();
      await prisma.auditLogEntry.updateMany({
        where: { entityId: createRes.body.id },
        data: { action: 'TAMPERED_VIA_DIRECT_DB_EDIT' },
      });

      const res = await request(server)
        .get('/api/v1/audit-entries/verify')
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200); // verification itself succeeds as a request — it's the RESULT that reports failure, not an HTTP error

      expect(res.body.valid).toBe(false);
      expect(res.body.firstMismatchReason).toBe('content');
    });
  });
});
