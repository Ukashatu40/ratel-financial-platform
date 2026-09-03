// test/e2e/expense-lifecycle.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('Expense lifecycle (e2e)', () => {
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

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();

    const org = await prisma.organization.create({ data: { name: 'E2E Test Org' } });
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

    const passwordHash = await hash('E2ePassword!23');
    const employee = await prisma.user.create({
      data: { email: 'employee@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: employee.id, organizationId: orgId, role: 'employee' },
    });

    const deptHead = await prisma.user.create({
      data: { email: 'depthead@e2e.test', passwordHash },
    });
    await prisma.departmentRoleAssignment.create({
      data: {
        userId: deptHead.id,
        organizationId: orgId,
        role: 'department_head',
        departmentId: deptId,
      },
    });

    // Org-scoped approver, needed for the two-step chain a large expense
    // resolves to (ExpenseApprovalPolicy's finance_director branch). Granting
    // finance_director its own permission gives department_head nothing extra,
    // so the cross-department 403 test below is unaffected.
    const financeDirector = await prisma.user.create({
      data: { email: 'findir@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: financeDirector.id, organizationId: orgId, role: 'finance_director' },
    });

    await prisma.rolePermission.createMany({
      data: [
        { role: 'employee', permission: 'expense:create', scope: 'own' },
        { role: 'department_head', permission: 'expense:approve', scope: 'department' },
        { role: 'finance_director', permission: 'expense:approve', scope: 'organization' },
      ],
    });
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'E2ePassword!23' })
      .expect(201); // NestJS default for POST with no @HttpCode override is 201

    return res.body.accessToken;
  }

  it('completes the full lifecycle: login -> create -> submit -> approve', async () => {
    const employeeToken = await loginAs('employee@e2e.test');

    const createRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits: 150000,
        currency: 'NGN',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(201);

    const expenseId = createRes.body.id;
    expect(createRes.body.expenseNumber).toBe('EXP-000001');

    await request(server)
      .post(`/api/v1/expenses/${expenseId}/submit`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(201);

    // Verify pending_approval directly via DB — no GET /:id endpoint exists
    // yet (flagged as a real gap in TECH_DEBT.md below), so this is the
    // only way to confirm intermediate state right now.
    const prisma = getE2eDbClient();
    let dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: expenseId } });
    expect(dbExpense.status).toBe('pending_approval');

    const deptHeadToken = await loginAs('depthead@e2e.test');

    await request(server)
      .post(`/api/v1/expenses/${expenseId}/approve`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .expect(201);

    dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: expenseId } });
    expect(dbExpense.status).toBe('approved');
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(server)
      .post('/api/v1/expenses')
      .send({
        sourceType: 'employee',
        amountMinorUnits: 1000,
        currency: 'NGN',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(401);
  });

  it('rejects an unsupported currency with a 400 that names it (TECH_DEBT #50)', async () => {
    // `CreateExpenseDto` validates `@Length(3, 3)` but not that the code is one
    // Money supports (NGN/USD/EUR/GBP), so 'XYZ' passes the ValidationPipe and
    // reaches `Money.of()`, which throws InvalidCurrencyError.
    //
    // Until #50 that was a bare Error, so ProblemDetailsFilter's fallback returned
    // 500 with the fixed detail "An unexpected error occurred" — the caller was not
    // told their currency was the problem. Asserting `type` and `detail`, not just
    // the status, is what makes this a regression test rather than a status check
    // that could pass for the wrong reason.
    const employeeToken = await loginAs('employee@e2e.test');

    const res = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits: 150000,
        currency: 'XYZ',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(400);

    expect(res.body.status).toBe(400);
    expect(res.body.type).toContain('unsupported-currency');
    expect(res.body.detail).toContain('XYZ');
  });

  it('rejects login with the wrong password using a generic message (no user enumeration)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'employee@e2e.test', password: 'WrongPassword!' })
      .expect(401);

    expect(res.body.detail).toBe('Invalid credentials');
  });

  it('rejects login for a nonexistent email with the SAME generic message', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'does-not-exist@e2e.test', password: 'anything' })
      .expect(401);

    expect(res.body.detail).toBe('Invalid credentials'); // proves it's the same message as wrong-password, per Phase 9.2
  });

  it('rejects an employee approving their own expense (self-approval, department scope but no expense:approve permission)', async () => {
    const employeeToken = await loginAs('employee@e2e.test');

    const createRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits: 5000,
        currency: 'NGN',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(201);

    await request(server)
      .post(`/api/v1/expenses/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(201);

    // Employee role has no expense:approve permission at all -> PermissionGuard blocks with 403
    // before the request even reaches WorkflowEngine's self-approval check.
    await request(server)
      .post(`/api/v1/expenses/${createRes.body.id}/approve`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  it('produces a hash-chained audit trail entry for each lifecycle transition', async () => {
    const employeeToken = await loginAs('employee@e2e.test');

    const createRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits: 20000,
        currency: 'NGN',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(201);

    await request(server)
      .post(`/api/v1/expenses/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(201);

    // The outbox dispatcher polls every 3s (JobsModule) — give it enough
    // time to actually run at least once before asserting on audit_log_entries.
    // This is the one place in this suite where we genuinely wait on async
    // background processing rather than asserting on synchronous API state.
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const prisma = getE2eDbClient();
    const auditEntries = await prisma.auditLogEntry.findMany({
      where: { entityId: createRes.body.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(auditEntries.map((e) => e.action)).toEqual([
      'ExpenseDrafted',
      'ExpenseSubmittedForApproval',
    ]);

    // Hash chain continuity check, same verification pattern used manually earlier
    for (let i = 1; i < auditEntries.length; i++) {
      expect(auditEntries[i].prevHash).toBe(auditEntries[i - 1].entryHash);
    }
  });

  describe('cross-department authorization (TECH_DEBT #3b)', () => {
    it('denies a department_head from Department B approving an expense in Department A', async () => {
      const prisma = getE2eDbClient();
      const passwordHash = await hash('E2ePassword!23');

      // Second department, with its own department_head — distinct from
      // the shared beforeEach's deptId/depthead@e2e.test fixture.
      const deptB = await prisma.department.create({
        data: { organizationId: orgId, name: 'Sales' },
      });
      const deptBHead = await prisma.user.create({
        data: { email: 'deptbhead@e2e.test', passwordHash },
      });
      await prisma.departmentRoleAssignment.create({
        data: {
          userId: deptBHead.id,
          organizationId: orgId,
          role: 'department_head',
          departmentId: deptB.id,
        },
      });

      // Create + submit an expense in Department A (the shared deptId fixture)
      const employeeToken = await loginAs('employee@e2e.test');
      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 30000,
          currency: 'NGN',
          categoryId,
          departmentId: deptId, // Department A
          expenseDate: '2026-08-02',
        })
        .expect(201);

      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);

      // Department B's head attempts to approve Department A's expense —
      // they hold expense:approve at department scope, but their OWN
      // department assignment (deptB.id) doesn't match the resource's
      // department (deptId) — this is exactly the check added to close
      // TECH_DEBT #3, and this is its first real test.
      const deptBHeadToken = await loginAs('deptbhead@e2e.test');
      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/approve`)
        .set('Authorization', `Bearer ${deptBHeadToken}`)
        .expect(403);

      // Confirm the expense is genuinely untouched — still pending, not
      // silently half-approved or corrupted by the rejected attempt.
      const dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: createRes.body.id } });
      expect(dbExpense.status).toBe('pending_approval');
    });

    it('allows the SAME department_head to approve an expense in their own department', async () => {
      // Positive-case control for the test above — proves the guard isn't
      // just blocking everything, only genuine cross-department attempts.
      const employeeToken = await loginAs('employee@e2e.test');
      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits: 30000,
          currency: 'NGN',
          categoryId,
          departmentId: deptId,
          expenseDate: '2026-08-02',
        })
        .expect(201);

      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);

      const deptHeadToken = await loginAs('depthead@e2e.test'); // this IS deptId's own head, from the shared beforeEach
      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/approve`)
        .set('Authorization', `Bearer ${deptHeadToken}`)
        .expect(201);

      const prisma = getE2eDbClient();
      const dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: createRes.body.id } });
      expect(dbExpense.status).toBe('approved');
    });
  });

  describe('approval chain thresholds (TECH_DEBT #10)', () => {
    /** Kobo for a naira figure — the DTO takes minor units, never naira. */
    const naira = (amount: number) => amount * 100;

    async function createAndSubmit(amountMinorUnits: number): Promise<string> {
      const employeeToken = await loginAs('employee@e2e.test');

      const createRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          sourceType: 'employee',
          amountMinorUnits,
          currency: 'NGN',
          categoryId,
          departmentId: deptId,
          expenseDate: '2026-08-02',
        })
        .expect(201);

      await request(server)
        .post(`/api/v1/expenses/${createRes.body.id}/submit`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);

      return createRes.body.id;
    }

    it('requires a SECOND finance_director approval above the ₦500,000 threshold', async () => {
      // First coverage anywhere of ExpenseApprovalPolicy's two-step branch —
      // resolveChain() was never invoked by any test before this.
      const prisma = getE2eDbClient();
      const expenseId = await createAndSubmit(naira(600_000));

      // Step 1 of 2: the department head's approval must NOT complete it.
      const deptHeadToken = await loginAs('depthead@e2e.test');
      await request(server)
        .post(`/api/v1/expenses/${expenseId}/approve`)
        .set('Authorization', `Bearer ${deptHeadToken}`)
        .expect(201);

      let dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: expenseId } });
      expect(dbExpense.status).toBe('pending_approval');

      // Step 2 of 2: finance_director closes the chain.
      const financeDirectorToken = await loginAs('findir@e2e.test');
      await request(server)
        .post(`/api/v1/expenses/${expenseId}/approve`)
        .set('Authorization', `Bearer ${financeDirectorToken}`)
        .expect(201);

      dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: expenseId } });
      expect(dbExpense.status).toBe('approved');
    });

    it('completes on department_head approval alone at ₦100,000 (threshold is ₦500,000, not ₦50,000)', async () => {
      // The regression control for the 10x defect. ₦100,000 sits BETWEEN the
      // buggy ₦50,000 threshold and the real ₦500,000 one, so under the old
      // constant this expense wrongly required a second approval and would
      // still be 'pending_approval' at the end of this test.
      const prisma = getE2eDbClient();
      const expenseId = await createAndSubmit(naira(100_000));

      const deptHeadToken = await loginAs('depthead@e2e.test');
      await request(server)
        .post(`/api/v1/expenses/${expenseId}/approve`)
        .set('Authorization', `Bearer ${deptHeadToken}`)
        .expect(201);

      const dbExpense = await prisma.expense.findFirstOrThrow({ where: { id: expenseId } });
      expect(dbExpense.status).toBe('approved');
    });
  });
});
