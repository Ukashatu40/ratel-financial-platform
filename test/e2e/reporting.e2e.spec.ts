// test/e2e/reporting.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { it, expect, describe, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('Reporting (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let deptAId: string;
  let deptBId: string;
  let categoryId: string;
  let vendorId: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let deptAHeadToken: string;
  let deptBHeadToken: string;
  let financeDirectorToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    // Guarded: if createTestApp() threw in beforeAll, `app` is undefined and an
    // unguarded app.close() throws a second error that REPLACES the real
    // bootstrap failure in Jest's output, hiding why the suite actually failed.
    await app?.close();
  });

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();
    const passwordHash = await hash('E2ePassword!23');

    const org = await prisma.organization.create({ data: { name: 'Reporting Test Org' } });
    await prisma.financialPeriod.create({
      data: {
        organizationId: org.id,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });

    const deptA = await prisma.department.create({
      data: { organizationId: org.id, name: 'Engineering' },
    });
    deptAId = deptA.id;
    const deptB = await prisma.department.create({
      data: { organizationId: org.id, name: 'Sales' },
    });
    deptBId = deptB.id;

    const category = await prisma.expenseCategory.create({
      data: { organizationId: org.id, name: 'Cloud Services' },
    });
    categoryId = category.id;
    const vendor = await prisma.vendor.create({ data: { organizationId: org.id, name: 'AWS' } });
    vendorId = vendor.id;

    await prisma.rolePermission.createMany({
      data: [
        { role: 'employee', permission: 'expense:create', scope: 'own' },
        { role: 'department_head', permission: 'expense:approve', scope: 'department' },
        { role: 'department_head', permission: 'report:view', scope: 'department' },
        { role: 'finance_director', permission: 'expense:approve', scope: 'organization' },
        { role: 'finance_director', permission: 'report:view', scope: 'organization' },
        { role: 'finance_director', permission: 'expense:adjust', scope: 'organization' }, // NEW — needed for the expense-adjustments-summary tests
      ],
    });

    const employeeA = await prisma.user.create({ data: { email: 'ea@e2e.test', passwordHash } });
    await prisma.organizationRoleAssignment.create({
      data: { userId: employeeA.id, organizationId: org.id, role: 'employee' },
    });
    const employeeB = await prisma.user.create({ data: { email: 'eb@e2e.test', passwordHash } });
    await prisma.organizationRoleAssignment.create({
      data: { userId: employeeB.id, organizationId: org.id, role: 'employee' },
    });

    const deptAHead = await prisma.user.create({ data: { email: 'dah@e2e.test', passwordHash } });
    await prisma.departmentRoleAssignment.create({
      data: {
        userId: deptAHead.id,
        organizationId: org.id,
        role: 'department_head',
        departmentId: deptAId,
      },
    });

    const deptBHead = await prisma.user.create({ data: { email: 'dbh@e2e.test', passwordHash } });
    await prisma.departmentRoleAssignment.create({
      data: {
        userId: deptBHead.id,
        organizationId: org.id,
        role: 'department_head',
        departmentId: deptBId,
      },
    });

    const financeDirector = await prisma.user.create({
      data: { email: 'fd@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: financeDirector.id, organizationId: org.id, role: 'finance_director' },
    });

    const login = async (email: string) =>
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'E2ePassword!23' })
          .expect(201)
      ).body.accessToken;

    employeeAToken = await login('ea@e2e.test');
    employeeBToken = await login('eb@e2e.test');
    deptAHeadToken = await login('dah@e2e.test');
    deptBHeadToken = await login('dbh@e2e.test');
    financeDirectorToken = await login('fd@e2e.test');
  });

  async function createSubmitApprove(
    creatorToken: string,
    approverToken: string,
    departmentId: string,
    amountMinorUnits: number,
  ): Promise<string> {
    const createRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits,
        currency: 'NGN',
        categoryId,
        departmentId,
        vendorId,
        expenseDate: '2026-08-15',
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/expenses/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(201);
    await request(server)
      .post(`/api/v1/expenses/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(201);
    return createRes.body.id;
  }

  // Note: every test below waits ~4s for the outbox dispatcher's 3s poll
  // interval — this makes the suite genuinely slow (~25s+ total). Worth
  // revisiting later (e.g. a configurable poll interval for test envs) but
  // not optimizing now, per the same "verify correctness first" approach
  // used throughout this build.

  it('projects approved expenses into the read model with the correct aggregate total', async () => {
    await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 100000);
    await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 200000);
    await new Promise((r) => setTimeout(r, 4000));

    const res = await request(server)
      .get('/api/v1/reports/department-spending?from=2026-08-01&to=2026-08-31')
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(200);

    const engineeringRow = res.body.find((r: any) => r.departmentId === deptAId);
    expect(engineeringRow.totalMinorUnits).toBe('300000');
    expect(engineeringRow.expenseCount).toBe(2);
  });

  it('a department_head only sees their OWN department, not others', async () => {
    await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 100000);
    await createSubmitApprove(employeeBToken, deptBHeadToken, deptBId, 500000); // was: financeDirectorToken
    await new Promise((r) => setTimeout(r, 4000));

    const res = await request(server)
      .get('/api/v1/reports/department-spending?from=2026-08-01&to=2026-08-31')
      .set('Authorization', `Bearer ${deptAHeadToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].departmentId).toBe(deptAId);
  });

  it('a finance_director sees ALL departments org-wide', async () => {
    await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 100000);
    await createSubmitApprove(employeeBToken, deptBHeadToken, deptBId, 500000); // was: financeDirectorToken
    await new Promise((r) => setTimeout(r, 4000));

    const res = await request(server)
      .get('/api/v1/reports/department-spending?from=2026-08-01&to=2026-08-31')
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(200);

    expect(res.body).toHaveLength(2);
  });

  it('an employee with no report:view grant is denied 403', async () => {
    await request(server)
      .get('/api/v1/reports/department-spending?from=2026-08-01&to=2026-08-31')
      .set('Authorization', `Bearer ${employeeAToken}`)
      .expect(403);
  });

  it('top-vendors aggregates correctly across multiple approved expenses to the same vendor', async () => {
    await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 100000);
    await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 150000);
    await new Promise((r) => setTimeout(r, 4000));

    const res = await request(server)
      .get('/api/v1/reports/top-vendors?from=2026-08-01&to=2026-08-31&limit=5')
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(200);

    expect(res.body[0].vendorId).toBe(vendorId);
    expect(res.body[0].totalMinorUnits).toBe('250000');
    expect(res.body[0].expenseCount).toBe(2);
  });

  it('a draft (never submitted/approved) expense does NOT appear in any report', async () => {
    await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeAToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits: 999999,
        currency: 'NGN',
        categoryId,
        departmentId: deptAId,
        vendorId,
        expenseDate: '2026-08-15',
      })
      .expect(201);
    // deliberately left in draft — never submitted

    await new Promise((r) => setTimeout(r, 4000));

    const res = await request(server)
      .get('/api/v1/reports/department-spending?from=2026-08-01&to=2026-08-31')
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(200);

    expect(res.body).toHaveLength(0); // status: 'approved' filter correctly excludes it
  });

  describe('top-categories', () => {
    it('returns categories ordered by total spend, respecting limit', async () => {
      const prisma = getE2eDbClient();
      const category2 = await prisma.expenseCategory.create({
        data: {
          organizationId: (await prisma.department.findUniqueOrThrow({ where: { id: deptAId } }))
            .organizationId,
          name: 'Travel',
        },
      });

      await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 100000); // Cloud Services (categoryId)
      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 500000,
          currency: 'NGN',
          categoryId: category2.id,
          departmentId: deptAId,
          expenseDate: '2026-08-15',
        })
        .expect(201)
        .then(async (createRes) => {
          await request(server)
            .post(`/api/v1/expenses/${createRes.body.id}/submit`)
            .set('Authorization', `Bearer ${employeeAToken}`)
            .expect(201);
          await request(server)
            .post(`/api/v1/expenses/${createRes.body.id}/approve`)
            .set('Authorization', `Bearer ${deptAHeadToken}`)
            .expect(201);
        });

      await new Promise((r) => setTimeout(r, 4000));

      const res = await request(server)
        .get('/api/v1/reports/top-categories?from=2026-08-01&to=2026-08-31&limit=1')
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].categoryId).toBe(category2.id); // Travel (500000) beats Cloud Services (100000)
      expect(res.body[0].totalMinorUnits).toBe('500000');
    });

    it('denies a role without report:view with 403', async () => {
      await request(server)
        .get('/api/v1/reports/top-categories?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(403);
    });
  });

  describe('project-spending', () => {
    // ASSUMPTION: CreateExpenseDto accepts `projectId`, matching vendorId's
    // established precedent in this file's createSubmitApprove(). Never seen
    // the DTO directly — flag if this field name is wrong.
    it('projects approved expenses by project, and enforces department scope', async () => {
      const prisma = getE2eDbClient();
      const org = await prisma.department.findUniqueOrThrow({ where: { id: deptAId } });
      const project = await prisma.project.create({
        data: { organizationId: org.organizationId, name: 'Website Redesign' },
      });

      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 200000,
          currency: 'NGN',
          categoryId,
          departmentId: deptAId,
          projectId: project.id,
          expenseDate: '2026-08-15',
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/approve`)
        .set('Authorization', `Bearer ${deptAHeadToken}`)
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      const asOwnHead = await request(server)
        .get('/api/v1/reports/project-spending?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${deptAHeadToken}`)
        .expect(200);
      expect(asOwnHead.body).toHaveLength(1);
      expect(asOwnHead.body[0].totalMinorUnits).toBe('200000');

      const asOtherHead = await request(server)
        .get('/api/v1/reports/project-spending?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${deptBHeadToken}`)
        .expect(200);
      expect(asOtherHead.body).toEqual([]); // dept B head cannot see dept A's project spend
    });

    it('denies a role without report:view with 403', async () => {
      await request(server)
        .get('/api/v1/reports/project-spending?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(403);
    });
  });

  describe('pending-department-spending', () => {
    it('shows a submitted-but-not-yet-approved expense, and excludes it once approved', async () => {
      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 300000,
          currency: 'NGN',
          categoryId,
          departmentId: deptAId,
          expenseDate: '2026-08-15',
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      const beforeApproval = await request(server)
        .get('/api/v1/reports/pending-department-spending?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);
      const row = beforeApproval.body.find((r: any) => r.departmentId === deptAId);
      expect(row.totalMinorUnits).toBe('300000');

      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/approve`)
        .set('Authorization', `Bearer ${deptAHeadToken}`)
        .expect(201);
      await new Promise((r) => setTimeout(r, 4000));

      const afterApproval = await request(server)
        .get('/api/v1/reports/pending-department-spending?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);
      // Now approved, so it must have LEFT the pending report entirely — this
      // is the control proving the status filter is genuinely 'pending_approval'
      // only, not 'approved OR pending_approval'.
      expect(afterApproval.body.find((r: any) => r.departmentId === deptAId)).toBeUndefined();
    });

    it('denies a role without report:view with 403', async () => {
      await request(server)
        .get('/api/v1/reports/pending-department-spending?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(403);
    });
  });

  describe('expense-status-breakdown', () => {
    it('reflects draft, pending_approval, approved and rejected expenses correctly', async () => {
      // draft — created, never submitted
      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 10000,
          currency: 'NGN',
          categoryId,
          departmentId: deptAId,
          expenseDate: '2026-08-15',
        })
        .expect(201);

      // pending_approval — created and submitted, left there
      const pendingRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 20000,
          currency: 'NGN',
          categoryId,
          departmentId: deptAId,
          expenseDate: '2026-08-15',
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${pendingRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(201);

      // approved
      await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 30000);

      // rejected
      const rejectedRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 40000,
          currency: 'NGN',
          categoryId,
          departmentId: deptAId,
          expenseDate: '2026-08-15',
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${rejectedRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${rejectedRes.body.id}/reject`)
        .set('Authorization', `Bearer ${deptAHeadToken}`)
        .send({ reason: 'test rejection' })
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      const res = await request(server)
        .get('/api/v1/reports/expense-status-breakdown?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      const byStatus = Object.fromEntries(res.body.map((r: any) => [r.status, r]));
      expect(byStatus.draft.totalMinorUnits).toBe('10000');
      expect(byStatus.pending_approval.totalMinorUnits).toBe('20000');
      expect(byStatus.approved.totalMinorUnits).toBe('30000');
      expect(byStatus.rejected.totalMinorUnits).toBe('40000');
      // Funnel order, not DB return order
      const statusOrder = res.body.map((r: any) => r.status);
      expect(statusOrder.indexOf('draft')).toBeLessThan(statusOrder.indexOf('pending_approval'));
      expect(statusOrder.indexOf('pending_approval')).toBeLessThan(statusOrder.indexOf('approved'));
    });

    it('denies a role without report:view with 403', async () => {
      await request(server)
        .get('/api/v1/reports/expense-status-breakdown?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(403);
    });
  });

  describe('cash-outflow', () => {
    it('buckets approved spend by month', async () => {
      await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 150000);
      await createSubmitApprove(employeeAToken, deptAHeadToken, deptAId, 250000);
      await new Promise((r) => setTimeout(r, 4000));

      const res = await request(server)
        .get('/api/v1/reports/cash-outflow?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].month).toBe('2026-08-01');
      expect(res.body[0].totalMinorUnits).toBe('400000');
      expect(res.body[0].expenseCount).toBe(2);
    });

    it('denies a role without report:view with 403', async () => {
      await request(server)
        .get('/api/v1/reports/cash-outflow?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(403);
    });
  });

  describe('expense-adjustments-summary', () => {
    it('nets a small (auto-approved) reversal and a large (approval-required) reversal correctly', async () => {
      const smallOriginalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        500000,
      );
      const smallAdjustRes = await request(server)
        .post(`/api/v1/expenses/${smallOriginalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Duplicate charge, small correction' })
        .expect(201);

      const largeOriginalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        150000000,
      );
      const largeAdjustRes = await request(server)
        .post(`/api/v1/expenses/${largeOriginalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Large reversal, genuinely needs sign-off' })
        .expect(201);

      await request(server)
        .post(`/api/v1/expenses/${largeAdjustRes.body.id}/approve`)
        .set('Authorization', `Bearer ${deptAHeadToken}`)
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${largeAdjustRes.body.id}/approve`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      // Expense.createAdjustment() dates every adjustment `new Date()` at the
      // moment it's created — NOT inherited from the original expense's
      // expenseDate (2026-08-15 here). So the query window must extend through
      // the actual moment this test ran, not just August 2026, or both
      // adjustment rows fall outside the filter even though the ORIGINAL
      // expenses are safely inside it.
      const to = new Date();
      to.setDate(to.getDate() + 1); // buffer past "now"
      const toParam = to.toISOString().slice(0, 10);

      const res = await request(server)
        .get(`/api/v1/reports/expense-adjustments-summary?from=2026-08-01&to=${toParam}`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      const row = res.body.find((r: any) => r.departmentId === deptAId);
      expect(row).toBeDefined();
      expect(row.netMinorUnits).toBe('-150500000');
      expect(row.adjustmentCount).toBe(2);

      void smallAdjustRes;
    });

    it('does NOT count an adjustment still sitting in pending_approval', async () => {
      const originalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        150000000,
      );
      await request(server)
        .post(`/api/v1/expenses/${originalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Left pending, deliberately not approved' })
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      // Same date-range fix as above — this adjustment is also dated "now".
      const to = new Date();
      to.setDate(to.getDate() + 1);
      const toParam = to.toISOString().slice(0, 10);

      const res = await request(server)
        .get(`/api/v1/reports/expense-adjustments-summary?from=2026-08-01&to=${toParam}`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      expect(res.body.find((r: any) => r.departmentId === deptAId)).toBeUndefined();
    });
    it('nets a small (auto-approved) reversal and a large (approval-required) reversal correctly', async () => {
      const smallOriginalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        500000,
      );
      const smallAdjustRes = await request(server)
        .post(`/api/v1/expenses/${smallOriginalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Duplicate charge, small correction' })
        .expect(201);

      const largeOriginalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        150000000,
      );
      const largeAdjustRes = await request(server)
        .post(`/api/v1/expenses/${largeOriginalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Large reversal, genuinely needs sign-off' })
        .expect(201);

      await request(server)
        .post(`/api/v1/expenses/${largeAdjustRes.body.id}/approve`)
        .set('Authorization', `Bearer ${deptAHeadToken}`)
        .expect(201);
      await request(server)
        .post(`/api/v1/expenses/${largeAdjustRes.body.id}/approve`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      // Expense.createAdjustment() dates every adjustment `new Date()` at the
      // moment it's created — NOT inherited from the original expense's
      // expenseDate (2026-08-15 here). So the query window must extend through
      // the actual moment this test ran, not just August 2026, or both
      // adjustment rows fall outside the filter even though the ORIGINAL
      // expenses are safely inside it.
      const to = new Date();
      to.setDate(to.getDate() + 1); // buffer past "now"
      const toParam = to.toISOString().slice(0, 10);

      const res = await request(server)
        .get(`/api/v1/reports/expense-adjustments-summary?from=2026-08-01&to=${toParam}`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      const row = res.body.find((r: any) => r.departmentId === deptAId);
      expect(row).toBeDefined();
      expect(row.netMinorUnits).toBe('-150500000');
      expect(row.adjustmentCount).toBe(2);

      void smallAdjustRes;
    });

    it('does NOT count an adjustment still sitting in pending_approval', async () => {
      const originalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        150000000,
      );
      await request(server)
        .post(`/api/v1/expenses/${originalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Left pending, deliberately not approved' })
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      // Same date-range fix as above — this adjustment is also dated "now".
      const to = new Date();
      to.setDate(to.getDate() + 1);
      const toParam = to.toISOString().slice(0, 10);

      const res = await request(server)
        .get(`/api/v1/reports/expense-adjustments-summary?from=2026-08-01&to=${toParam}`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      expect(res.body.find((r: any) => r.departmentId === deptAId)).toBeUndefined();
    });

    it('does NOT count an adjustment still sitting in pending_approval', async () => {
      const originalId = await createSubmitApprove(
        employeeAToken,
        deptAHeadToken,
        deptAId,
        150000000, // above threshold
      );
      await request(server)
        .post(`/api/v1/expenses/${originalId}/adjustments`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .send({ reason: 'Left pending, deliberately not approved' })
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      const res = await request(server)
        .get('/api/v1/reports/expense-adjustments-summary?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(200);

      expect(res.body.find((r: any) => r.departmentId === deptAId)).toBeUndefined();
    });

    it('denies a role without report:view with 403', async () => {
      await request(server)
        .get('/api/v1/reports/expense-adjustments-summary?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${employeeAToken}`)
        .expect(403);
    });
  });
});
