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

  /**
   * Waits until the background worker has actually finished with a job, instead
   * of guessing how long that takes. The fixed `setTimeout(4000)` used elsewhere
   * in this file is a latent flake — it fires whenever the suite gets busier —
   * so new assertions that depend on the worker use this instead.
   */
  async function waitForJobToSettle(
    prisma: ReturnType<typeof getE2eDbClient>,
    importJobId: string,
    timeoutMs = 20000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = await prisma.importJob.findUnique({ where: { id: importJobId } });
      if (job && (job.status === 'completed' || job.status === 'failed')) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

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

  // TECH_DEBT #25 — any uploaded bytes were previously accepted as CSV and
  // only failed later inside the worker, leaving an ImportJob in `failed`.
  describe('upload file-type validation', () => {
    const expectNoJobCreated = async () => {
      const prisma = getE2eDbClient();
      expect(await prisma.importJob.count({ where: { organizationId: orgId } })).toBe(0);
    };

    it('rejects a PDF with a 400, not a queued job that fails later', async () => {
      const res = await request(server)
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'), 'invoice.pdf')
        .expect(400);

      expect(res.body.type).toContain('unsupported-import-file');
      expect(res.body.detail).toContain('a PDF');
      await expectNoJobCreated();
    });

    it('rejects an .xlsx workbook — the most likely honest mistake', async () => {
      const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
      const res = await request(server)
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', xlsx, 'expenses.xlsx')
        .expect(400);

      expect(res.body.detail).toContain('.xlsx');
      await expectNoJobCreated();
    });

    it('rejects binary content even when it is LABELLED as text/csv', async () => {
      // The security-adjacent half of #25: the declared type is client-supplied,
      // so an allowed value must not be enough to get bytes accepted.
      const res = await request(server)
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
          filename: 'definitely-a.csv',
          contentType: 'text/csv',
        })
        .expect(400);

      expect(res.body.detail).toContain('PNG');
      await expectNoJobCreated();
    });

    it('rejects an empty file', async () => {
      const res = await request(server)
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.alloc(0), 'empty.csv')
        .expect(400);

      expect(res.body.detail).toContain('empty');
      await expectNoJobCreated();
    });

    it('CONTROL: still accepts a real CSV with a UTF-8 BOM, as Excel writes it', async () => {
      // Without this, "reject everything" would pass every test above.
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      await request(server)
        .post('/api/v1/imports')
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.concat([bom, Buffer.from(validCsv)]), 'excel-export.csv')
        .expect(201);

      const prisma = getE2eDbClient();
      expect(await prisma.importJob.count({ where: { organizationId: orgId } })).toBe(1);
    });
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

      // TECH_DEBT #44 — a whole-file failure produces no FailedImportRecord
      // rows, so before this the caller got `status: 'failed'` and nothing
      // else; the reason was reachable only in server logs. The reason must
      // now be specific enough to self-serve a fix (which columns are
      // missing), not just "it failed".
      expect(statusRes.body.failureReason).toContain('Missing required column(s)');
      expect(statusRes.body.failureReason).toContain('department');

      // Still no per-row errors for this failure mode — the whole file died
      // before any row was reached, which is exactly why #44 existed.
      const errorsRes = await request(server)
        .get(`/api/v1/imports/${uploadRes.body.importJobId}/errors`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);
      expect(errorsRes.body).toEqual([]);

      const prisma = getE2eDbClient();
      expect(await prisma.expense.count({ where: { organizationId: orgId } })).toBe(0);
    });

    it('leaves failureReason null on a successful import', async () => {
      // The control for the above: a populated failureReason must mean
      // something actually failed, not just that the column exists.
      const saveRes = await saveMapping(fullMapping).expect(201);

      const uploadRes = await request(server)
        .post(`/api/v1/imports?mappingId=${saveRes.body.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
        .expect(201);

      await new Promise((r) => setTimeout(r, 4000));

      const statusRes = await request(server)
        .get(`/api/v1/imports/${uploadRes.body.importJobId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.failureReason).toBeNull();
    });

    it('clears a previous attempt\'s failureReason when the job is processed again', async () => {
      // The same ImportJob row can legitimately be processed more than once
      // (operator re-enqueue, queue redelivery — the path the Inbox pattern
      // exists for). A stale reason surviving onto a `completed` job would be
      // worse than having no reason at all, since it reads as authoritative.
      const saveRes = await saveMapping(fullMapping).expect(201);
      const uploadRes = await request(server)
        .post(`/api/v1/imports?mappingId=${saveRes.body.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
        .expect(201);
      const importJobId = uploadRes.body.importJobId;

      await new Promise((r) => setTimeout(r, 4000));

      // Plant a reason as a prior failed attempt would have left it, then
      // re-run the very same job.
      const prisma = getE2eDbClient();
      await prisma.importJob.update({
        where: { id: importJobId },
        data: { failureReason: 'stale reason from an earlier attempt' },
      });

      const queue = app.get<Queue>(`BullQueue_${IMPORT_JOB_QUEUE}`);
      await queue.add(IMPORT_JOB_NAME, { importJobId });

      await new Promise((r) => setTimeout(r, 4000));

      const statusRes = await request(server)
        .get(`/api/v1/imports/${importJobId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(200);

      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.failureReason).toBeNull();
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

    // TECH_DEBT #43 — mappings could be created and listed but never removed.
    describe('deleting a saved mapping', () => {
      it('deletes it, and it stops appearing in the list', async () => {
        const saveRes = await saveMapping(fullMapping, 'Obsolete Source').expect(201);

        await request(server)
          .delete(`/api/v1/imports/column-mappings/${saveRes.body.id}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(200);

        const listRes = await request(server)
          .get('/api/v1/imports/column-mappings')
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(200);

        expect(listRes.body).toEqual([]);
      });

      it('makes the deleted mappingId unusable for a subsequent upload', async () => {
        // The behavioural control: gone from the list isn't the same as gone.
        const saveRes = await saveMapping(fullMapping, 'Obsolete Source').expect(201);

        await request(server)
          .delete(`/api/v1/imports/column-mappings/${saveRes.body.id}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(200);

        await request(server)
          .post(`/api/v1/imports?mappingId=${saveRes.body.id}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
          .expect(404);
      });

      it('leaves an ALREADY-PROCESSED import job intact', async () => {
        // The whole reason hard delete is defensible here: ImportJob snapshots
        // the mapping content, so deleting the mapping cannot retroactively
        // change or damage a job that was parsed with it.
        const saveRes = await saveMapping(fullMapping).expect(201);

        const uploadRes = await request(server)
          .post(`/api/v1/imports?mappingId=${saveRes.body.id}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .attach('file', Buffer.from(nonCanonicalCsv), 'bank-export.csv')
          .expect(201);

        // Polled rather than a fixed sleep: a hard-coded wait is a latent flake
        // that fires whenever the suite gets busier, which is exactly what
        // happened to this test once another spec file was added.
        const prisma = getE2eDbClient();
        const settled = await waitForJobToSettle(prisma, uploadRes.body.importJobId);
        expect(settled).toBe(true);

        await request(server)
          .delete(`/api/v1/imports/column-mappings/${saveRes.body.id}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(200);

        const statusRes = await request(server)
          .get(`/api/v1/imports/${uploadRes.body.importJobId}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(200);

        expect(statusRes.body.status).toBe('completed');
        expect(statusRes.body.successCount).toBe(1);

        const job = await prisma.importJob.findUniqueOrThrow({
          where: { id: uploadRes.body.importJobId },
        });
        expect(job.resolvedMapping).toEqual(fullMapping); // snapshot survived the delete
      });

      it('returns 404 for an unknown mapping id', async () => {
        await request(server)
          .delete('/api/v1/imports/column-mappings/00000000-0000-4000-8000-000000000999')
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(404);
      });

      it('refuses to delete a mapping belonging to a DIFFERENT organization', async () => {
        const prisma = getE2eDbClient();
        const otherOrg = await prisma.organization.create({ data: { name: 'Someone Else Ltd' } });
        const foreign = await prisma.columnMapping.create({
          data: { organizationId: otherOrg.id, name: 'Theirs', mapping: fullMapping },
        });

        await request(server)
          .delete(`/api/v1/imports/column-mappings/${foreign.id}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .expect(404);

        // 404 must mean "not yours", not "deleted anyway" — assert it survived.
        expect(
          await prisma.columnMapping.findUnique({ where: { id: foreign.id } }),
        ).not.toBeNull();
      });

      it('rejects an unauthenticated delete with 401', async () => {
        const saveRes = await saveMapping(fullMapping).expect(201);

        await request(server)
          .delete(`/api/v1/imports/column-mappings/${saveRes.body.id}`)
          .expect(401);
      });
    });
  });
});
