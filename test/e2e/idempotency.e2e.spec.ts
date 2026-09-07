// test/e2e/idempotency.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * Proves the Phase 7.5 Idempotency-Key mechanism (TECH_DEBT — closing the
 * "no idempotency-key support anywhere" gap) actually prevents the
 * concrete harm it exists for: a network retry double-creating a
 * financial record. `POST /expenses` is the representative endpoint — the
 * interceptor itself is generic and global (idempotency.module.ts), so
 * proving it once thoroughly is the same coverage bar #51 used for a
 * currently-single-call-site invariant.
 */
describe('Idempotency-Key (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let deptId: string;
  let categoryId: string;
  let employeeToken: string;

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
    await prisma.rolePermission.createMany({
      data: [{ role: 'employee', permission: 'expense:create', scope: 'own' }],
    });

    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'employee@e2e.test', password: 'E2ePassword!23' })
      .expect(201);
    employeeToken = loginRes.body.accessToken;
  });

  function expenseBody(overrides: Record<string, unknown> = {}) {
    return {
      sourceType: 'employee',
      amountMinorUnits: 150000,
      currency: 'NGN',
      categoryId,
      departmentId: deptId,
      expenseDate: '2026-08-02',
      ...overrides,
    };
  }

  it('replays the cached response instead of creating a duplicate expense', async () => {
    const first = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('Idempotency-Key', 'e2e-retry-key-1')
      .send(expenseBody())
      .expect(201);

    const second = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('Idempotency-Key', 'e2e-retry-key-1')
      .send(expenseBody())
      .expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const prisma = getE2eDbClient();
    const count = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(count).toBe(1);
  });

  it('creates independent expenses when no Idempotency-Key is sent — proves the interceptor is opt-in, not sticky', async () => {
    const first = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send(expenseBody())
      .expect(201);

    const second = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send(expenseBody())
      .expect(201);

    expect(second.body.id).not.toBe(first.body.id);

    const prisma = getE2eDbClient();
    const count = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(count).toBe(2);
  });

  it('handles two concurrent requests with the same key without double-creating — exactly one expense exists afterward', async () => {
    const key = 'e2e-race-key';
    const [r1, r2] = await Promise.all([
      request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('Idempotency-Key', key)
        .send(expenseBody()),
      request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('Idempotency-Key', key)
        .send(expenseBody()),
    ]);

    // Whichever request loses the race gets 409 (a concurrent claim on the
    // same key, not yet resolved to a cached response) rather than being
    // silently allowed to execute a second time — that's the actual
    // invariant this feature exists to enforce, not "exactly one 201".
    const responses = [r1, r2];
    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(successes.length + conflicts.length).toBe(2);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    const ids = new Set(successes.map((r) => r.body.id));
    expect(ids.size).toBe(1);

    for (const conflict of conflicts) {
      expect(conflict.body).toMatchObject({
        status: 409,
        type: expect.stringContaining('idempotency-key-in-progress'),
      });
    }

    const prisma = getE2eDbClient();
    const count = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(count).toBe(1);
  });

  it('rejects an Idempotency-Key longer than 255 characters with a 400', async () => {
    const res = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('Idempotency-Key', 'x'.repeat(256))
      .send(expenseBody())
      .expect(400);

    expect(res.body.type).toContain('invalid-idempotency-key');

    const prisma = getE2eDbClient();
    const count = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(count).toBe(0);
  });

  it('does not replay a failed request — a retry after a real failure gets a fresh, real attempt', async () => {
    // Reused key, but the second attempt has a genuinely different (invalid)
    // currency, proving failures aren't cached against the key at all —
    // if they were, this would replay the FIRST call's outcome instead of
    // evaluating the new request on its own.
    const key = 'e2e-failure-then-retry';

    await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('Idempotency-Key', key)
      .send(expenseBody({ currency: 'XYZ' }))
      .expect(400);

    const retry = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('Idempotency-Key', key)
      .send(expenseBody())
      .expect(201);

    expect(retry.headers['idempotency-replayed']).toBeUndefined();

    const prisma = getE2eDbClient();
    const count = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(count).toBe(1);
  });
});
