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
});
