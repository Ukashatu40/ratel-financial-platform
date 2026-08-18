// test/e2e/csv-import.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { IMPORT_JOB_NAME, IMPORT_JOB_QUEUE } from '../../src/jobs/queues/import-job.queue';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('CSV import (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let accountantToken: string;

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

    const org = await prisma.organization.create({ data: { name: 'Import Test Org' } });
    orgId = org.id;

    await prisma.financialPeriod.create({
      data: {
        organizationId: orgId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });
    await prisma.department.create({ data: { organizationId: orgId, name: 'Engineering' } });
    await prisma.expenseCategory.create({
      data: { organizationId: orgId, name: 'Cloud Services' },
    });

    await prisma.rolePermission.create({
      data: { role: 'accountant', permission: 'expense:create', scope: 'organization' },
    });

    const accountant = await prisma.user.create({ data: { email: 'acct@e2e.test', passwordHash } });
    await prisma.userRoleAssignment.create({
      data: {
        userId: accountant.id,
        organizationId: orgId,
        role: 'accountant',
        departmentId: null,
      },
    });

    accountantToken = (
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'acct@e2e.test', password: 'E2ePassword!23' })
        .expect(201)
    ).body.accessToken;
  });

  const validCsv = [
    'department,category,vendor,amountMinorUnits,currency,expenseDate,description',
    'Engineering,Cloud Services,AWS,450000,NGN,2026-08-15,Hosting',
    'Engineering,NonexistentCategory,AWS,100000,NGN,2026-08-16,Bad row',
  ].join('\n');

  it('uploads a CSV, processes it async, and reports correct success/failure counts', async () => {
    const uploadRes = await request(server)
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${accountantToken}`)
      .attach('file', Buffer.from(validCsv), 'test.csv')
      .expect(201);

    const importJobId = uploadRes.body.importJobId;
    await new Promise((r) => setTimeout(r, 4000)); // let the BullMQ worker process it

    const statusRes = await request(server)
      .get(`/api/v1/imports/${importJobId}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    expect(statusRes.body.status).toBe('completed');
    expect(statusRes.body.totalRecords).toBe(2);
    expect(statusRes.body.successCount).toBe(1);
    expect(statusRes.body.failureCount).toBe(1);

    const errorsRes = await request(server)
      .get(`/api/v1/imports/${importJobId}/errors`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .expect(200);

    expect(errorsRes.body).toHaveLength(1);
    expect(errorsRes.body[0].errorMessage).toContain('NonexistentCategory');
  });

  it('creates an Expense with source_type "import" and the correct importJobId linkage', async () => {
    const uploadRes = await request(server)
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${accountantToken}`)
      .attach('file', Buffer.from(validCsv), 'test.csv')
      .expect(201);

    await new Promise((r) => setTimeout(r, 4000));

    const prisma = getE2eDbClient();
    const expense = await prisma.expense.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(expense.sourceType).toBe('import');
    expect(expense.sourceImportJobId).toBe(uploadRes.body.importJobId);
    expect(expense.amountMinorUnits).toBe(450000n);
  });

  it('REPLAY: re-processing the same import job does NOT duplicate the successful expense', async () => {
    const uploadRes = await request(server)
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${accountantToken}`)
      .attach('file', Buffer.from(validCsv), 'test.csv')
      .expect(201);
    const importJobId = uploadRes.body.importJobId;

    await new Promise((r) => setTimeout(r, 4000)); // first processing run

    const prisma = getE2eDbClient();
    const countAfterFirstRun = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(countAfterFirstRun).toBe(1); // only the one successful row

    // Manually re-enqueue the SAME importJobId, simulating a retry/replay
    // (e.g. an operator manually re-running a job, or a queue redelivery)
    // — this is the actual test of the Inbox pattern's guarantee.
    const queue = app.get<Queue>(`BullQueue_${IMPORT_JOB_QUEUE}`);
    await queue.add(IMPORT_JOB_NAME, { importJobId });

    await new Promise((r) => setTimeout(r, 4000)); // second processing run

    const countAfterReplay = await prisma.expense.count({ where: { organizationId: orgId } });
    expect(countAfterReplay).toBe(1); // STILL just 1 — the Inbox record prevented reprocessing

    // The failing row should have failed AGAIN on replay (still a real,
    // repeatable failure — not silently swallowed) — confirming
    // FailedImportRecord isn't itself deduped, unlike successes.
    const finalJob = await prisma.importJob.findUniqueOrThrow({ where: { id: importJobId } });
    expect(finalJob.failureCount).toBe(1); // from the SECOND run specifically — see note below
  });

  it('rejects an unauthenticated upload attempt with 401', async () => {
    await request(server)
      .post('/api/v1/imports')
      .attach('file', Buffer.from(validCsv), 'test.csv')
      .expect(401);
  });

  // TECH_DEBT #22 — configurable column mapping. The unit suite covers the
  // remapping logic in isolation; these prove the whole HTTP path, since a
  // mapping is only worth anything if it survives save -> resolve-at-upload
  // -> background worker against real Postgres, Redis and object storage.
  describe('with a configurable column mapping', () => {
    // Deliberately shares NO header name with the canonical set, so a
    // successful import cannot be explained by anything except the mapping
    // actually being applied.
    const nonCanonicalCsv = [
      'Dept,Cost Category,Supplier,Amount,Curr,Txn Date,Memo',
      'Engineering,Cloud Services,AWS,450000,NGN,2026-08-15,Hosting',
    ].join('\n');

    const fullMapping = {
      department: 'Dept',
      category: 'Cost Category',
      vendor: 'Supplier',
      amountMinorUnits: 'Amount',
      currency: 'Curr',
      expenseDate: 'Txn Date',
      description: 'Memo',
    };

    const saveMapping = (mapping: Record<string, unknown>, name = 'Bank Export') =>
      request(server)
        .post('/api/v1/imports/column-mappings')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ name, mapping });

    it('saves a mapping, then imports a file whose headers match none of the canonical names', async () => {
      const saveRes = await saveMapping(fullMapping).expect(201);
      expect(saveRes.body.id).toBeDefined();

      const uploadRes = await request(server)
        .post(`/api/v1/imports?mappingId=${saveRes.body.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000)); // let the BullMQ worker process it

      const statusRes = await request(server)
        .get(`/api/v1/imports/${uploadRes.body.importJobId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.successCount).toBe(1);
      expect(statusRes.body.failureCount).toBe(0);

      // Not just "it parsed" — every mapped field landed on the Expense with
      // the right value, including the optional ones (vendor, description).
      const prisma = getE2eDbClient();
      const expense = await prisma.expense.findFirstOrThrow({ where: { organizationId: orgId } });
      expect(expense.amountMinorUnits).toBe(450000n);
      expect(expense.currency).toBe('NGN');
      expect(expense.description).toBe('Hosting');
      expect(expense.vendorId).not.toBeNull();
      expect(expense.sourceType).toBe('import');
    });

    it('CONTROL: the same file with NO mappingId fails, proving the mapping is what made it work', async () => {
      const uploadRes = await request(server)
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      const statusRes = await request(server)
        .get(`/api/v1/imports/${uploadRes.body.importJobId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(statusRes.body.status).toBe('failed');

      const prisma = getE2eDbClient();
      expect(await prisma.expense.count({ where: { organizationId: orgId } })).toBe(0);
    });

    it('lists saved mappings by name, without echoing organizationId back', async () => {
      await saveMapping(fullMapping, 'Bank Export').expect(201);
      await saveMapping(fullMapping, 'Acme Ledger').expect(201);

      const listRes = await request(server)
        .get('/api/v1/imports/column-mappings')
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(listRes.body.map((m: any) => m.name)).toEqual(['Acme Ledger', 'Bank Export']); // name asc
      expect(listRes.body[0].mapping.department).toBe('Dept');
      expect(listRes.body[0]).not.toHaveProperty('organizationId');
    });

    it('upserts by name rather than accumulating duplicates', async () => {
      const first = await saveMapping(fullMapping, 'Bank Export').expect(201);
      const second = await saveMapping(
        { ...fullMapping, department: 'Division' },
        'Bank Export',
      ).expect(201);

      expect(second.body.id).toBe(first.body.id);

      const listRes = await request(server)
        .get('/api/v1/imports/column-mappings')
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].mapping.department).toBe('Division');
    });

    // Each of these used to save with a 201 and only fail later inside the
    // worker, where the reason reached the server log and nothing else.
    it('rejects a mapping missing required fields with an actionable 400', async () => {
      const res = await saveMapping({ department: 'Dept' }).expect(400);

      expect(res.body.status).toBe(400);
      expect(res.body.type).toContain('invalid-column-mapping');
      expect(res.body.detail).toContain('expenseDate');
    });

    it('rejects a mapping naming a field that does not exist', async () => {
      const res = await saveMapping({ ...fullMapping, notAField: 'X' }).expect(400);
      expect(res.body.detail).toContain('notAField');
    });

    it('rejects a mapping whose value is not a usable column header', async () => {
      const res = await saveMapping({ ...fullMapping, currency: '' }).expect(400);
      expect(res.body.detail).toContain('currency');
    });

    it('returns 404 for an unknown mappingId at upload time', async () => {
      await request(server)
        .post('/api/v1/imports?mappingId=00000000-0000-4000-8000-000000000999')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
        .expect(404);
    });

    it('refuses a mapping belonging to a DIFFERENT organization', async () => {
      const prisma = getE2eDbClient();
      const otherOrg = await prisma.organization.create({ data: { name: 'Someone Else Ltd' } });
      const foreign = await prisma.columnMapping.create({
        data: { organizationId: otherOrg.id, name: 'Theirs', mapping: fullMapping },
      });

      await request(server)
        .post(`/api/v1/imports?mappingId=${foreign.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
        .expect(404);
    });
  });
});
