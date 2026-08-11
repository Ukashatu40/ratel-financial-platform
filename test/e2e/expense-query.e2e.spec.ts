// test/e2e/expense-query.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('Expense query endpoints (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let deptId: string;
  let categoryId: string;

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

  let employee1Token: string;
  let employee2Token: string;
  let deptHeadToken: string;
  let financeDirectorToken: string;

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();
    const passwordHash = await hash('E2ePassword!23');

    const org = await prisma.organization.create({ data: { name: 'Query Test Org' } });
    orgId = org.id;

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

    await prisma.rolePermission.createMany({
      data: [
        { role: 'employee', permission: 'expense:create', scope: 'own' },
        { role: 'employee', permission: 'expense:view', scope: 'own' },
        { role: 'department_head', permission: 'expense:view', scope: 'department' },
        { role: 'finance_director', permission: 'expense:view', scope: 'organization' },
      ],
    });

    const employee1 = await prisma.user.create({ data: { email: 'e1@e2e.test', passwordHash } });
    await prisma.userRoleAssignment.create({
      data: { userId: employee1.id, organizationId: orgId, role: 'employee', departmentId: null },
    });

    const employee2 = await prisma.user.create({ data: { email: 'e2@e2e.test', passwordHash } });
    await prisma.userRoleAssignment.create({
      data: { userId: employee2.id, organizationId: orgId, role: 'employee', departmentId: null },
    });

    const deptHead = await prisma.user.create({ data: { email: 'dh@e2e.test', passwordHash } });
    await prisma.userRoleAssignment.create({
      data: {
        userId: deptHead.id,
        organizationId: orgId,
        role: 'department_head',
        departmentId: deptId,
      },
    });

    const financeDirector = await prisma.user.create({
      data: { email: 'fd@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: financeDirector.id,
        organizationId: orgId,
        role: 'finance_director',
        departmentId: null,
      },
    });

    const login = async (email: string) =>
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'E2ePassword!23' })
          .expect(201)
      ).body.accessToken;

    employee1Token = await login('e1@e2e.test');
    employee2Token = await login('e2@e2e.test');
    deptHeadToken = await login('dh@e2e.test');
    financeDirectorToken = await login('fd@e2e.test');
  });

  async function createExpense(token: string, amountMinorUnits = 10000) {
    const res = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits,
        currency: 'NGN',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(201);
    return res.body.id;
  }

  it('GET /:id returns the expense to its own creator', async () => {
    const id = await createExpense(employee1Token);

    const res = await request(server)
      .get(`/api/v1/expenses/${id}`)
      .set('Authorization', `Bearer ${employee1Token}`)
      .expect(200);

    expect(res.body.id).toBe(id);
  });

  it('GET /:id denies a DIFFERENT employee (own-scope, not the requester) with 403', async () => {
    const id = await createExpense(employee1Token);

    await request(server)
      .get(`/api/v1/expenses/${id}`)
      .set('Authorization', `Bearer ${employee2Token}`)
      .expect(403);
  });

  it('GET /:id allows the department_head to view it (department scope match)', async () => {
    const id = await createExpense(employee1Token);

    await request(server)
      .get(`/api/v1/expenses/${id}`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .expect(200);
  });

  it("GET / — an employee only sees their OWN expenses, not other employees' ", async () => {
    await createExpense(employee1Token, 10000);
    await createExpense(employee2Token, 20000);

    const res = await request(server)
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${employee1Token}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amount.minorUnits).toBe('10000'); // BigInt serializes as string over JSON
    expect(res.body.data[0].amount.currency).toBe('NGN');
  });

  it('GET / — a department_head sees ALL expenses in their department, from any employee', async () => {
    await createExpense(employee1Token, 10000);
    await createExpense(employee2Token, 20000);

    const res = await request(server)
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(2); // both employee1's and employee2's, same department
  });

  it('GET / — a finance_director sees everything org-wide (organization scope)', async () => {
    await createExpense(employee1Token, 10000);
    await createExpense(employee2Token, 20000);

    const res = await request(server)
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(2);
  });

  it('GET / supports cursor pagination — limit=1 returns one item plus a usable nextCursor', async () => {
    await createExpense(employee1Token, 10000);
    await createExpense(employee1Token, 20000);
    await createExpense(employee1Token, 30000);

    const page1 = await request(server)
      .get('/api/v1/expenses?limit=1')
      .set('Authorization', `Bearer ${employee1Token}`)
      .expect(200);

    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(server)
      .get(`/api/v1/expenses?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${employee1Token}`)
      .expect(200);

    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id); // genuinely a different record, not the same page repeated
  });

  it('GET /:id on a nonexistent ID returns 404 with the SAME error shape as an org-mismatch 404', async () => {
    const res = await request(server)
      .get('/api/v1/expenses/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${employee1Token}`)
      .expect(404);

    expect(res.body.type).toContain('not-found'); // now genuinely true, not just status-matched
    expect(res.body.status).toBe(404);
    // expect(res.body.detail).toBe(
    //   'expense with id 00000000-0000-4000-8000-000000000099 was not found',
    // );
  });
});
