// test/e2e/payroll-lifecycle.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * First payroll e2e spec in this repo — per notification.subscriber.spec.ts's
 * own comment, standing this up needed employees, salary structures and real
 * field encryption, a materially larger fixture than anything else in this
 * suite. Also the first e2e spec to exercise AesGcmEnvelopeEncryptionService
 * end-to-end at all (every other e2e spec either doesn't touch encrypted
 * fields, or the integration specs substitute TestEncryptionService — this
 * one boots the real app via createTestApp(), so encryption is genuinely
 * real here, keyed off env-setup.ts's fixed deterministic test key).
 */
describe('Payroll lifecycle (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let deptId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  let payrollAdminToken: string;
  let financeDirectorToken: string;
  let employeeToken: string; // holds NO payroll permissions — the 403 control

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();
    const passwordHash = await hash('E2ePassword!23');

    const org = await prisma.organization.create({ data: { name: 'Payroll E2E Org' } });
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

    await prisma.rolePermission.createMany({
      data: [
        { role: 'payroll_admin', permission: 'payroll:create', scope: 'organization' },
        { role: 'payroll_admin', permission: 'payroll:view_sensitive', scope: 'organization' },
        { role: 'finance_director', permission: 'payroll:approve', scope: 'organization' },
      ],
    });

    const payrollAdmin = await prisma.user.create({
      data: { email: 'payrolladmin@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: payrollAdmin.id, organizationId: orgId, role: 'payroll_admin' },
    });

    const financeDirector = await prisma.user.create({
      data: { email: 'findir@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: financeDirector.id, organizationId: orgId, role: 'finance_director' },
    });

    // No payroll grant at all — the 403 control.
    const employee = await prisma.user.create({
      data: { email: 'employee@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: employee.id, organizationId: orgId, role: 'employee' },
    });

    const login = async (email: string) =>
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email, password: 'E2ePassword!23' })
          .expect(201)
      ).body.accessToken;

    payrollAdminToken = await login('payrolladmin@e2e.test');
    financeDirectorToken = await login('findir@e2e.test');
    employeeToken = await login('employee@e2e.test');
  });

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

  it('completes the full lifecycle: employee -> salary structure -> run -> payslip -> submit -> approve -> process', async () => {
    const prisma = getE2eDbClient();

    const employeeRes = await request(server)
      .post('/api/v1/employees')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ fullName: 'Amaka Okoro' })
      .expect(201);
    const employeeId = employeeRes.body.id;

    const structureRes = await request(server)
      .post(`/api/v1/employees/${employeeId}/salary-structure`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({
        effectiveFrom: '2026-01-01',
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base Salary', amountMinorUnits: 400000 },
        ],
      })
      .expect(201);
    expect(structureRes.body.id).toBeDefined();

    // Proves the real encryption round trip: this response comes back through
    // decryptJson(), not a stub — the actual value must survive genuine
    // AES-GCM encrypt-then-decrypt via the real KEK from env-setup.ts.
    const getStructureRes = await request(server)
      .get(`/api/v1/employees/${employeeId}/salary-structure`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(200);
    expect(getStructureRes.body.baseSalaryLineItems).toEqual([
      {
        kind: 'allowance',
        label: 'Base Salary',
        amount: { minorUnits: '400000', currency: 'NGN' },
      },
    ]);

    const runRes = await request(server)
      .post('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ runMonth: '2026-08-01' })
      .expect(201);
    const runId = runRes.body.id;

    const payslipRes = await request(server)
      .post(`/api/v1/payroll-runs/${runId}/payslips`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ employeeId })
      .expect(201);
    expect(payslipRes.body.payslipId).toBeDefined();

    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/submit`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(201);

    let dbRun = await prisma.payrollRun.findFirstOrThrow({ where: { id: runId } });
    expect(dbRun.status).toBe('pending_approval');

    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/approve`)
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(201);

    dbRun = await prisma.payrollRun.findFirstOrThrow({ where: { id: runId } });
    expect(dbRun.status).toBe('approved');

    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/process`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(201);

    // ProcessPayrollRunHandler calls startProcessing() then complete() in the
    // SAME transaction — the run is NEVER persisted at 'processing'. Only
    // 'completed' is ever observable here.
    dbRun = await prisma.payrollRun.findFirstOrThrow({ where: { id: runId } });
    expect(dbRun.status).toBe('completed');

    // Real encryption round trip for the payslip's netPay too: single
    // allowance, no deductions, noOpTaxComputation -> net === gross.
    const runDetailRes = await request(server)
      .get(`/api/v1/payroll-runs/${runId}`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(200);
    expect(runDetailRes.body.status).toBe('completed');
    expect(runDetailRes.body.payslips).toHaveLength(1);
    expect(runDetailRes.body.payslips[0]).toMatchObject({
      employeeId,
      grossPay: { minorUnits: '400000', currency: 'NGN' },
      netPay: { minorUnits: '400000', currency: 'NGN' },
    });
  }, 60000);

  it('records the approved -> processing transition in the audit trail, even though the persisted row never shows it (TECH_DEBT #52)', async () => {
    // First e2e proof of this — until now only proven at the integration
    // layer (payroll-run-audit-trail.spec.ts), never through the real HTTP
    // -> outbox -> BullMQ poller -> AuditSubscriber path.
    const prisma = getE2eDbClient();

    const employeeRes = await request(server)
      .post('/api/v1/employees')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ fullName: 'Tunde Bello' })
      .expect(201);
    const employeeId = employeeRes.body.id;

    await request(server)
      .post(`/api/v1/employees/${employeeId}/salary-structure`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({
        effectiveFrom: '2026-01-01',
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base Salary', amountMinorUnits: 300000 },
        ],
      })
      .expect(201);

    const runRes = await request(server)
      .post('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ runMonth: '2026-08-01' })
      .expect(201);
    const runId = runRes.body.id;

    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/payslips`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ employeeId })
      .expect(201);
    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/submit`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(201);
    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/approve`)
      .set('Authorization', `Bearer ${financeDirectorToken}`)
      .expect(201);
    await request(server)
      .post(`/api/v1/payroll-runs/${runId}/process`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(201);

    const audited = await waitFor(async () => {
      const entry = await prisma.auditLogEntry.findFirst({
        where: { entityId: runId, action: 'PayrollRunProcessingStarted' },
      });
      return entry !== null;
    });
    expect(audited).toBe(true);

    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { entityId: runId, action: 'PayrollRunProcessingStarted' },
    });
    expect(entry.entityType).toBe('PayrollRun');
    expect(entry.organizationId).toBe(orgId);
    expect(entry.oldValue).toEqual({ status: 'approved' });
    expect(entry.newValue).toMatchObject({
      changes: { status: { from: 'approved', to: 'processing' } },
    });
  }, 60000);

  it('denies a role without payroll:create from creating a payroll run, with 403', async () => {
    await request(server)
      .post('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ runMonth: '2026-08-01' })
      .expect(403);
  });

  it('denies a role without payroll:approve from approving a submitted run, with 403', async () => {
    const employeeRes = await request(server)
      .post('/api/v1/employees')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ fullName: 'Chidi Nwosu' })
      .expect(201);
    const employeeId = employeeRes.body.id;

    await request(server)
      .post(`/api/v1/employees/${employeeId}/salary-structure`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({
        effectiveFrom: '2026-01-01',
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base Salary', amountMinorUnits: 250000 },
        ],
      })
      .expect(201);

    const runRes = await request(server)
      .post('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ runMonth: '2026-08-01' })
      .expect(201);

    await request(server)
      .post(`/api/v1/payroll-runs/${runRes.body.id}/payslips`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ employeeId })
      .expect(201);
    await request(server)
      .post(`/api/v1/payroll-runs/${runRes.body.id}/submit`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(201);

    // payroll_admin holds payroll:create, not payroll:approve.
    await request(server)
      .post(`/api/v1/payroll-runs/${runRes.body.id}/approve`)
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .expect(403);
  });

  it('rejects creating a SECOND payroll run for the same organization and month with 409', async () => {
    await request(server)
      .post('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ runMonth: '2026-08-01' })
      .expect(201);

    await request(server)
      .post('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${payrollAdminToken}`)
      .send({ runMonth: '2026-08-01' })
      .expect(409);
  });
});
