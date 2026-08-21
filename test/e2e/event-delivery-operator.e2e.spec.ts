// test/e2e/event-delivery-operator.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * TECH_DEBT #47 — the operator surface over `failed_event_deliveries`.
 *
 * #9 made a lost subscriber delivery durable and automatically retried, but a row
 * that exhausted its retries was reachable only through psql. For
 * `AuditSubscriber` that row means a financial event is missing from the audit
 * trail, and the hash chain cannot reveal it: the chain proves entries were not
 * ALTERED, and a chain missing an entry is still a valid chain.
 *
 * Rows are created directly here because nothing creates them on purpose — they
 * are produced by real failures, which `event-delivery-retry.e2e.spec.ts` already
 * drives end to end through the live pipeline. This spec covers the read/redrive
 * API on top of them, including the org-scoping and permission boundaries.
 */
describe('Event delivery operator API (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    // Guarded for the same reason as every other e2e spec: an unguarded close on a
    // failed boot throws a second error that hides the real one.
    await app?.close();
  });

  beforeEach(async () => {
    await cleanE2eDatabase();
    const prisma = getE2eDbClient();

    const org = await prisma.organization.create({ data: { name: 'E2E Org' } });
    orgId = org.id;
    const other = await prisma.organization.create({ data: { name: 'E2E Other Org' } });
    otherOrgId = other.id;

    const passwordHash = await hash('E2ePassword!23');

    const director = await prisma.user.create({
      data: { email: 'findir@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: director.id,
        organizationId: orgId,
        role: 'finance_director',
        departmentId: null,
      },
    });

    // The negative control's actor: authenticated, in the same org, but holding a
    // role that is NOT granted event-delivery:manage. Without this, a passing 200
    // could just mean the guard never runs.
    const employee = await prisma.user.create({
      data: { email: 'employee@e2e.test', passwordHash },
    });
    await prisma.userRoleAssignment.create({
      data: { userId: employee.id, organizationId: orgId, role: 'employee', departmentId: null },
    });

    await prisma.rolePermission.createMany({
      data: [
        { role: 'finance_director', permission: 'event-delivery:manage', scope: 'organization' },
        { role: 'employee', permission: 'expense:create', scope: 'own' },
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

  /** A failure row as the pipeline would have left it. */
  async function seedDelivery(
    overrides: {
      organizationId?: string;
      status?: 'pending_retry' | 'recovered' | 'permanently_failed';
      subscriberName?: string;
      outboxEventId?: string;
      attempts?: number;
    } = {},
  ) {
    const prisma = getE2eDbClient();
    // Own-keys presence checks, not `??`: an explicit override must apply even
    // when it is falsy (critical convention #4).
    return prisma.failedEventDelivery.create({
      data: {
        outboxEventId: 'outboxEventId' in overrides ? overrides.outboxEventId! : 'outbox-1',
        eventType: 'ExpenseApproved',
        subscriberName:
          'subscriberName' in overrides ? overrides.subscriberName! : 'AuditSubscriber',
        lastError: 'db down',
        attempts: 'attempts' in overrides ? overrides.attempts! : 6,
        status: 'status' in overrides ? overrides.status! : 'permanently_failed',
        organizationId: 'organizationId' in overrides ? overrides.organizationId! : orgId,
      },
    });
  }

  describe('GET /event-deliveries', () => {
    it('lists failed deliveries for the caller organization', async () => {
      await seedDelivery();
      const token = await loginAs('findir@e2e.test');

      const res = await request(server)
        .get('/api/v1/event-deliveries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        subscriberName: 'AuditSubscriber',
        eventType: 'ExpenseApproved',
        status: 'permanently_failed',
        attempts: 6,
      });
    });

    it('does not leak organizationId back to a caller that already knows it', async () => {
      // Projected through EventDeliveryView rather than returning the Prisma row,
      // per #22's reasoning when it stopped GET /imports/column-mappings echoing
      // raw rows. Asserted as an exact key set so widening this response has to be
      // a deliberate change here — #21's discipline.
      await seedDelivery();
      const token = await loginAs('findir@e2e.test');

      const res = await request(server)
        .get('/api/v1/event-deliveries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Object.keys(res.body[0]).sort()).toEqual([
        'attempts',
        'createdAt',
        'eventType',
        'id',
        'lastError',
        'outboxEventId',
        'status',
        'subscriberName',
        'updatedAt',
      ]);
    });

    it('never returns another organization\'s deliveries', async () => {
      await seedDelivery({ organizationId: otherOrgId, outboxEventId: 'outbox-elsewhere' });
      const token = await loginAs('findir@e2e.test');

      const res = await request(server)
        .get('/api/v1/event-deliveries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('filters by status', async () => {
      await seedDelivery({ outboxEventId: 'outbox-1', status: 'permanently_failed' });
      await seedDelivery({ outboxEventId: 'outbox-2', status: 'recovered' });
      const token = await loginAs('findir@e2e.test');

      const failed = await request(server)
        .get('/api/v1/event-deliveries?status=permanently_failed')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(failed.body).toHaveLength(1);
      expect(failed.body[0].outboxEventId).toBe('outbox-1');

      // The control: the filter must actually filter, not be ignored.
      const all = await request(server)
        .get('/api/v1/event-deliveries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('rejects an unknown status with a specific 400, not a generic 500', async () => {
      // An unvalidated value reaching Prisma's `where` surfaces as a raw client
      // error, which ProblemDetailsFilter can only render as a useless 500
      // (critical convention #5).
      const token = await loginAs('findir@e2e.test');

      const res = await request(server)
        .get('/api/v1/event-deliveries?status=nonsense')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('permanently_failed');
    });

    it('denies a role without event-delivery:manage', async () => {
      await seedDelivery();
      const token = await loginAs('employee@e2e.test');

      await request(server)
        .get('/api/v1/event-deliveries')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('GET /event-deliveries/:id', () => {
    it('returns one delivery', async () => {
      const row = await seedDelivery();
      const token = await loginAs('findir@e2e.test');

      const res = await request(server)
        .get(`/api/v1/event-deliveries/${row.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(row.id);
    });

    it("returns 404 for another organization's delivery, not 403", async () => {
      // Scoped in the same where clause as the id, per #43: "not yours" is
      // indistinguishable from "doesn't exist", so this cannot be used to probe
      // which ids exist in other organizations.
      const row = await seedDelivery({ organizationId: otherOrgId });
      const token = await loginAs('findir@e2e.test');

      await request(server)
        .get(`/api/v1/event-deliveries/${row.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /event-deliveries/:id/retry', () => {
    const waitFor = async (
      predicate: () => Promise<boolean>,
      timeoutMs = 20000,
      intervalMs = 250,
    ): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await predicate()) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return false;
    };

    it('requeues a permanently-failed delivery as real, picked-up work', async () => {
      const row = await seedDelivery({ status: 'permanently_failed', attempts: 6 });
      const token = await loginAs('findir@e2e.test');

      const res = await request(server)
        .post(`/api/v1/event-deliveries/${row.id}/retry`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body).toEqual({ requeued: true });

      // Deliberately NOT asserting `status === 'pending_retry'` here. The handler
      // writes that, but a newly-added BullMQ job runs its first attempt with no
      // backoff delay, so the worker often transitions the row before this line
      // executes — an assertion on the intermediate state is a race.
      //
      // Waiting for the worker's own outcome is both deterministic AND a stronger
      // claim: it proves the enqueue produced real work rather than just a status
      // write. No outbox row was seeded, so the redelivery correctly reaches
      // "payload unrecoverable" — which is the one path that must not count an
      // attempt, asserted below.
      const prisma = getE2eDbClient();
      const pickedUp = await waitFor(async () => {
        const r = await prisma.failedEventDelivery.findUnique({ where: { id: row.id } });
        return r !== null && r.lastError.includes('unrecoverable');
      });
      expect(pickedUp).toBe(true);

      const after = await prisma.failedEventDelivery.findUniqueOrThrow({ where: { id: row.id } });
      // Still 6: the subscriber was never invoked, so the redrive is not an attempt.
      // Before the counter fix this whole path could also have rewritten 6 as 2.
      expect(after.attempts).toBe(6);
    });

    it('refuses a pending_retry delivery with 409 rather than a silent no-op', async () => {
      // A live BullMQ job already exists under jobId `redeliver-<id>`, so a second
      // enqueue would be deduplicated and the operator told "requeued" while
      // nothing happened. Refusing is the honest answer — the silent-no-op version
      // of this is the defect corrected under #9.
      const row = await seedDelivery({ status: 'pending_retry' });
      const token = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/event-deliveries/${row.id}/retry`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('refuses an already-recovered delivery with 409', async () => {
      const row = await seedDelivery({ status: 'recovered' });
      const token = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/event-deliveries/${row.id}/retry`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it("returns 404 when retrying another organization's delivery, and leaves it untouched", async () => {
      const row = await seedDelivery({ organizationId: otherOrgId });
      const token = await loginAs('findir@e2e.test');

      await request(server)
        .post(`/api/v1/event-deliveries/${row.id}/retry`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const prisma = getE2eDbClient();
      const after = await prisma.failedEventDelivery.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('permanently_failed'); // not requeued
    });

    it('denies a role without event-delivery:manage', async () => {
      const row = await seedDelivery();
      const token = await loginAs('employee@e2e.test');

      await request(server)
        .post(`/api/v1/event-deliveries/${row.id}/retry`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });
});
