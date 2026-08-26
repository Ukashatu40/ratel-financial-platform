// test/e2e/financial-period-lifecycle.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * The financial-period reopen path.
 *
 * Closing a period is enforced by NINE call sites across Expense and Payroll, all
 * throwing PeriodClosedError once the period is not open. Nothing could undo a
 * close, so an expense left in `pending_approval` at close time could be neither
 * approved NOR rejected — permanently stranded, via entirely ordinary use.
 *
 * The stranding test below is the one that matters: it asserts the 409 FIRST, so a
 * passing reopen cannot be explained by the record having been approvable all
 * along. `FinancialPeriod.reopen()` and `PeriodStatus.reopened` already existed;
 * only the application path did not.
 */
describe('Financial period lifecycle (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let otherOrgId: string;
  let periodId: string;
  let deptId: string;
  let categoryId: string;
  let directorId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    // Guarded: an unguarded close on a failed boot throws a second error that
    // replaces the real bootstrap failure in Jest's output.
    await app?.close();
  });

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();
    const passwordHash = await hash('E2ePassword!23');

    const org = await prisma.organization.create({ data: { name: 'Period E2E Org' } });
    orgId = org.id;
    const other = await prisma.organization.create({ data: { name: 'Period E2E Other Org' } });
    otherOrgId = other.id;

    const period = await prisma.financialPeriod.create({
      data: {
        organizationId: orgId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });
    periodId = period.id;

    const dept = await prisma.department.create({
      data: { organizationId: orgId, name: 'Engineering' },
    });
    deptId = dept.id;
    const category = await prisma.expenseCategory.create({
      data: { organizationId: orgId, name: 'Cloud' },
    });
    categoryId = category.id;

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

    const director = await prisma.user.create({
      data: { email: 'findir@e2e.test', passwordHash },
    });
    directorId = director.id;
    await prisma.userRoleAssignment.create({
      data: {
        userId: director.id,
        organizationId: orgId,
        role: 'finance_director',
        departmentId: null,
      },
    });

    await prisma.rolePermission.createMany({
      data: [
        { role: 'employee', permission: 'expense:create', scope: 'own' },
        { role: 'department_head', permission: 'expense:approve', scope: 'department' },
        // reopen reuses period:open deliberately — no new permission was added, so
        // no re-seed is required for this capability.
        { role: 'finance_director', permission: 'period:open', scope: 'organization' },
        { role: 'finance_director', permission: 'period:close', scope: 'organization' },
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

  const waitFor = async (
    predicate: () => Promise<boolean>,
    timeoutMs = 25000,
    intervalMs = 250,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  };

  /** Creates and submits an expense small enough to need only one approval step. */
  async function submitExpense(token: string): Promise<string> {
    const createRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'employee',
        // ₦1,500 — well under ExpenseApprovalPolicy's ₦500,000 escalation, so a
        // single department_head approval completes it and the test is about the
        // period, not the approval chain.
        amountMinorUnits: 150000,
        currency: 'NGN',
        categoryId,
        departmentId: deptId,
        expenseDate: '2026-08-02',
      })
      .expect(201);

    await request(server)
      .post(`/api/v1/expenses/${createRes.body.id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    return createRes.body.id;
  }

  it('unstrands an expense that a period close had frozen mid-approval', async () => {
    const prisma = getE2eDbClient();
    const employeeToken = await loginAs('employee@e2e.test');
    const deptHeadToken = await loginAs('depthead@e2e.test');
    const directorToken = await loginAs('findir@e2e.test');

    const expenseId = await submitExpense(employeeToken);
    expect((await prisma.expense.findFirstOrThrow({ where: { id: expenseId } })).status).toBe(
      'pending_approval',
    );

    // --- Close the period with the expense still awaiting approval.
    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${directorToken}`)
      .expect(201);

    // --- THE STRANDING. Asserted before the reopen exists in the flow, so the
    // recovery below cannot be explained by the expense having been approvable
    // anyway. Both directions are blocked: approve AND reject.
    await request(server)
      .post(`/api/v1/expenses/${expenseId}/approve`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .expect(409);

    await request(server)
      .post(`/api/v1/expenses/${expenseId}/reject`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .send({ reason: 'trying to clear it out' })
      .expect(409);

    expect((await prisma.expense.findFirstOrThrow({ where: { id: expenseId } })).status).toBe(
      'pending_approval', // still stuck
    );

    // --- Reopen, with the required reason.
    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/reopen`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ reason: 'Expense EXP-000001 was left mid-approval at close' })
      .expect(201);

    const reopened = await prisma.financialPeriod.findUniqueOrThrow({ where: { id: periodId } });
    expect(reopened.status).toBe('reopened');
    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedById).toBeNull();

    // --- The same approval that returned 409 now succeeds, with no other change.
    await request(server)
      .post(`/api/v1/expenses/${expenseId}/approve`)
      .set('Authorization', `Bearer ${deptHeadToken}`)
      .expect(201);

    expect((await prisma.expense.findFirstOrThrow({ where: { id: expenseId } })).status).toBe(
      'approved',
    );
  }, 60000);

  it('records the reopen reason in the audit log, with no audit-side code', async () => {
    // AuditSubscriber is registered globally and already lifts payload['reason']
    // into the entry's reason column, so putting the reason on the PeriodReopened
    // payload is the entire implementation of this. Asserted end to end through the
    // real outbox poller rather than trusted.
    const prisma = getE2eDbClient();
    const directorToken = await loginAs('findir@e2e.test');
    const REASON = 'Reversal of a duplicated vendor payment, approved by CFO';

    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${directorToken}`)
      .expect(201);

    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/reopen`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ reason: REASON })
      .expect(201);

    const audited = await waitFor(async () => {
      const entry = await prisma.auditLogEntry.findFirst({
        where: { entityId: periodId, action: 'PeriodReopened' },
      });
      return entry !== null;
    });
    expect(audited).toBe(true);

    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { entityId: periodId, action: 'PeriodReopened' },
    });
    expect(entry.reason).toBe(REASON);
    expect(entry.entityType).toBe('FinancialPeriod');
    expect(entry.organizationId).toBe(orgId);
    // The actor is on the payload as reopenedById; assert it survived the round
    // trip through the outbox rather than only the reason. `reopenedById` is also
    // in AuditSubscriber's ACTOR_KEYS, so it must land in actorUserId as well —
    // checking both proves the payload arrived intact AND was interpreted.
    expect(entry.newValue).toMatchObject({ reason: REASON, reopenedById: directorId });
    expect(entry.actorUserId).toBe(directorId);
  }, 60000);

  describe('open controls', () => {
    it('rejects a reversed date range with a 400 that names the actual problem', async () => {
      // The #50 regression test. `OpenPeriodDto` validates only date FORMAT, so a
      // reversed range passes the ValidationPipe and reaches
      // FinancialPeriod.create(), where InvalidPeriodDatesError is thrown.
      //
      // Asserting the body, not just the status, is the whole point: as a bare
      // Error this hit ProblemDetailsFilter's fallback branch, which returns 500
      // with the fixed detail "An unexpected error occurred" — so the caller was
      // told nothing about what was wrong with their request. The `type` and
      // `detail` assertions are what would fail if the class stopped extending
      // DomainError, since a status-only check could pass for the wrong reason.
      const prisma = getE2eDbClient();
      const directorToken = await loginAs('findir@e2e.test');

      const res = await request(server)
        .post('/api/v1/financial-periods')
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ startDate: '2026-09-30', endDate: '2026-09-01' })
        .expect(400);

      expect(res.body.status).toBe(400);
      expect(res.body.type).toContain('invalid-period-dates');
      expect(res.body.detail).toContain('end_date must be after start_date');

      // Nothing persisted — only the period the beforeEach created.
      const periods = await prisma.financialPeriod.findMany({ where: { organizationId: orgId } });
      expect(periods).toHaveLength(1);
      expect(periods[0].id).toBe(periodId);
    });

    it('opens a period for a valid date range', async () => {
      // Positive control: the 400 above must not be explained by this endpoint
      // rejecting everything, and nothing else in this spec exercises POST at all
      // (every other period is inserted through Prisma directly).
      const directorToken = await loginAs('findir@e2e.test');

      const res = await request(server)
        .post('/api/v1/financial-periods')
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ startDate: '2026-09-01', endDate: '2026-09-30' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      const created = await getE2eDbClient().financialPeriod.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(created.organizationId).toBe(orgId);
      expect(created.status).toBe('open');
    });
  });

  describe('close controls', () => {
    it("returns 404 for another organization's period, and leaves it open", async () => {
      // The decisive scoping control, and the regression test for #49: this period
      // is OPEN, so the unscoped `findById` that ClosePeriodHandler used until now
      // would have found it and closed it with 201. Own-organization close is
      // exercised with 201 by several tests above, so a 404 here cannot be
      // explained by close having broken for everyone.
      const prisma = getE2eDbClient();
      const foreign = await prisma.financialPeriod.create({
        data: {
          organizationId: otherOrgId,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-31'),
          status: 'open',
        },
      });
      const directorToken = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${foreign.id}/close`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(404);

      // Untouched, asserted on the close metadata too and not just the status: a
      // partially-applied close that wrote closedAt/closedById while leaving the
      // status alone would be worse than an outright wrong status, and only these
      // assertions would catch it.
      const after = await prisma.financialPeriod.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(after.status).toBe('open');
      expect(after.closedAt).toBeNull();
      expect(after.closedById).toBeNull();
    });

    it('still closes a period in the caller own organization', async () => {
      // The positive control, kept local to this describe block so the 404 above
      // cannot be read as "close is simply broken" (#3b's reasoning).
      const directorToken = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/close`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(201);

      const after = await getE2eDbClient().financialPeriod.findUniqueOrThrow({
        where: { id: periodId },
      });
      expect(after.status).toBe('closed');
      expect(after.closedById).toBe(directorId);
    });
  });

  describe('reopen controls', () => {
    it('refuses to reopen a period that is already open, with 409', async () => {
      const directorToken = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/reopen`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ reason: 'it is already open' })
        .expect(409);
    });

    it("returns 404 for another organization's period, and leaves it closed", async () => {
      // The decisive scoping control: this period is CLOSED, so an unscoped lookup
      // would have found it and succeeded with 201.
      const prisma = getE2eDbClient();
      const foreign = await prisma.financialPeriod.create({
        data: {
          organizationId: otherOrgId,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-31'),
          status: 'closed',
          closedById: null,
          closedAt: new Date('2026-09-01'),
        },
      });
      const directorToken = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${foreign.id}/reopen`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ reason: 'should not be permitted' })
        .expect(404);

      const after = await prisma.financialPeriod.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(after.status).toBe('closed'); // untouched
    });

    it('denies a role without period:open, with 403', async () => {
      const employeeToken = await loginAs('employee@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/reopen`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ reason: 'not allowed to do this' })
        .expect(403);
    });

    it('rejects a missing or blank reason with 400', async () => {
      const directorToken = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/close`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(201);

      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/reopen`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({})
        .expect(400);

      // Whitespace passes class-validator's @IsNotEmpty; the aggregate's trim is
      // what rejects it, and it must still surface as a 400 rather than a 500 —
      // which requires PeriodReopenReasonRequiredError to extend DomainError.
      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/reopen`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ reason: '    ' })
        .expect(400);

      const stillClosed = await getE2eDbClient().financialPeriod.findUniqueOrThrow({
        where: { id: periodId },
      });
      expect(stillClosed.status).toBe('closed');
    });
  });

  describe('period discovery', () => {
    it('lists periods including closed ones, which GET /current cannot surface', async () => {
      const directorToken = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/financial-periods/${periodId}/close`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(201);

      // The control that shows why this endpoint had to exist: with the only period
      // closed, `current` has nothing to return, so the id needed for a reopen was
      // unobtainable through the API. Asserted on the absence of an id rather than
      // on the body being falsy — an empty response deserializes to {}, which is
      // truthy, so a falsy check here would fail for the wrong reason.
      const current = await request(server)
        .get('/api/v1/financial-periods/current')
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(current.body?.id).toBeUndefined();

      const list = await request(server)
        .get('/api/v1/financial-periods')
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ id: periodId, status: 'closed' });
    });

    it('filters by status, and rejects an unknown status with 400', async () => {
      const directorToken = await loginAs('findir@e2e.test');

      const open = await request(server)
        .get('/api/v1/financial-periods?status=open')
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(open.body).toHaveLength(1);

      const closed = await request(server)
        .get('/api/v1/financial-periods?status=closed')
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(closed.body).toEqual([]);

      await request(server)
        .get('/api/v1/financial-periods?status=nonsense')
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(400);
    });

    it("never lists another organization's periods", async () => {
      const prisma = getE2eDbClient();
      await prisma.financialPeriod.create({
        data: {
          organizationId: otherOrgId,
          startDate: new Date('2026-09-01'),
          endDate: new Date('2026-09-30'),
          status: 'open',
        },
      });
      const directorToken = await loginAs('findir@e2e.test');

      const list = await request(server)
        .get('/api/v1/financial-periods')
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);

      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(periodId);
    });

    it('gets one period by id, and 404s across organizations', async () => {
      const prisma = getE2eDbClient();
      const foreign = await prisma.financialPeriod.create({
        data: {
          organizationId: otherOrgId,
          startDate: new Date('2026-09-01'),
          endDate: new Date('2026-09-30'),
          status: 'open',
        },
      });
      const directorToken = await loginAs('findir@e2e.test');

      const mine = await request(server)
        .get(`/api/v1/financial-periods/${periodId}`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(mine.body.id).toBe(periodId);

      await request(server)
        .get(`/api/v1/financial-periods/${foreign.id}`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(404);
    });

    it('denies listing to a role without period:open', async () => {
      const employeeToken = await loginAs('employee@e2e.test');

      await request(server)
        .get('/api/v1/financial-periods')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });
  });
});
