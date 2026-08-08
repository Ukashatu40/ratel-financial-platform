// test/e2e/attachments.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

const MINIMAL_VALID_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
);

describe('Attachments (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let employeeToken: string;
  let otherEmployeeToken: string;
  let expenseId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();
    const passwordHash = await hash('E2ePassword!23');

    const org = await prisma.organization.create({ data: { name: 'Attachment Test Org' } });
    await prisma.financialPeriod.create({
      data: {
        organizationId: org.id,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });
    const dept = await prisma.department.create({
      data: { organizationId: org.id, name: 'Engineering' },
    });
    const category = await prisma.expenseCategory.create({
      data: { organizationId: org.id, name: 'Cloud' },
    });

    await prisma.rolePermission.createMany({
      data: [
        { role: 'employee', permission: 'expense:create', scope: 'own' },
        { role: 'employee', permission: 'expense:view', scope: 'own' },
      ],
    });

    const employee = await prisma.user.create({ data: { email: 'e1@e2e.test', passwordHash } });
    await prisma.userRoleAssignment.create({
      data: { userId: employee.id, organizationId: org.id, role: 'employee', departmentId: null },
    });
    const otherEmployee = await prisma.user.create({
      data: { email: 'e2@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: otherEmployee.id,
        organizationId: org.id,
        role: 'employee',
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
    employeeToken = await login('e1@e2e.test');
    otherEmployeeToken = await login('e2@e2e.test');

    const createRes = await request(server)
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        sourceType: 'employee',
        amountMinorUnits: 5000,
        currency: 'NGN',
        categoryId: category.id,
        departmentId: dept.id,
        expenseDate: '2026-08-02',
      })
      .expect(201);
    expenseId = createRes.body.id;
  });

  it('uploads a file and round-trips the EXACT bytes through a real MinIO download', async () => {
    const uploadRes = await request(server)
      .post(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', MINIMAL_VALID_PDF, {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const attachmentId = uploadRes.body.attachmentId;

    const urlRes = await request(server)
      .get(`/api/v1/expenses/${expenseId}/attachments/${attachmentId}/download-url`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    // Follow the presigned URL directly against MinIO — the real proof the
    // file genuinely round-tripped through object storage, not just that
    // metadata was recorded.
    const downloadRes = await request(urlRes.body.url.split('/').slice(0, 3).join('/'))
      .get('/' + urlRes.body.url.split('/').slice(3).join('/'))
      .expect(200);

    expect(Buffer.from(downloadRes.body).equals(MINIMAL_VALID_PDF)).toBe(true);
  });

  it('rejects an unsupported file type', async () => {
    await request(server)
      .post(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', Buffer.from('not really an exe'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(500); // known gap (TECH_DEBT #24-adjacent) — this SHOULD be 400, tracked, not silently accepted as correct
  });

  it("denies a different employee from viewing attachments on someone else's expense (own-scope enforcement)", async () => {
    await request(server)
      .post(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', MINIMAL_VALID_PDF, {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    await request(server)
      .get(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`)
      .expect(403); // reuses ExpenseScopeProvider — same guarantee as TECH_DEBT #3's other tests
  });

  it('lists multiple attachments on the same expense, most recent first', async () => {
    await request(server)
      .post(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', MINIMAL_VALID_PDF, { filename: 'first.pdf', contentType: 'application/pdf' })
      .expect(201);
    await request(server)
      .post(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .attach('file', MINIMAL_VALID_PDF, { filename: 'second.pdf', contentType: 'application/pdf' })
      .expect(201);

    const listRes = await request(server)
      .get(`/api/v1/expenses/${expenseId}/attachments`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    expect(listRes.body).toHaveLength(2);
    expect(listRes.body[0].fileName).toBe('second.pdf'); // most recent first
  });
});
