// test/e2e/step-up.e2e.spec.ts
import request from 'supertest';
import { hash } from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { STEP_UP_DEFAULTS } from '../../src/shared-kernel/auth/step-up';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * Proves the Phase 9.2 step-up mechanism (TECH_DEBT — closing the
 * "no MFA readiness / step-up auth" gap): `period:close` and
 * `payroll:view_sensitive` refuse a plain login token and accept one
 * that has been through `POST /auth/step-up`, and a step-up goes stale
 * after its window.
 *
 * The staleness test forges an already-old `stepUpAt` directly (via a
 * standalone `JwtService` signing with the same test secret env-setup.ts
 * configures) rather than waiting out the real window or overriding
 * `STEP_UP_WINDOW_MS` — env-setup.ts's env vars are read through
 * `ConfigService`, whose validated snapshot is fixed once at app boot, so
 * a per-test `process.env` mutation (the trick `rate-limiting.e2e.spec.ts`
 * uses) doesn't apply here the way it does for the rate limiter's
 * request-time `process.env` reads. Forging the token sidesteps the
 * question entirely AND proves the real 10-minute production default,
 * which a shortened test-only window wouldn't.
 */
describe('Step-up re-authentication (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;
  let orgId: string;
  let periodId: string;

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
    const passwordHash = await hash('E2ePassword!23');

    const org = await prisma.organization.create({ data: { name: 'Step-up E2E Org' } });
    orgId = org.id;

    const period = await prisma.financialPeriod.create({
      data: {
        organizationId: orgId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        status: 'open',
      },
    });
    periodId = period.id;

    const director = await prisma.user.create({
      data: { email: 'findir@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: director.id, organizationId: orgId, role: 'finance_director' },
    });

    const payrollAdmin = await prisma.user.create({
      data: { email: 'payrolladmin@e2e.test', passwordHash },
    });
    await prisma.organizationRoleAssignment.create({
      data: { userId: payrollAdmin.id, organizationId: orgId, role: 'payroll_admin' },
    });

    await prisma.rolePermission.createMany({
      data: [
        { role: 'finance_director', permission: 'period:close', scope: 'organization' },
        { role: 'payroll_admin', permission: 'payroll:view_sensitive', scope: 'organization' },
      ],
    });
  });

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'E2ePassword!23' })
      .expect(201);
    return res.body.accessToken;
  }

  // Deliberately NOT `async` — returns the chainable supertest Test object
  // itself so callers can attach their own `.expect(status)` before
  // awaiting, the same pattern `login()`'s inline calls use.
  function stepUp(token: string, password = 'E2ePassword!23') {
    return request(server)
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ password });
  }

  it('refuses a sensitive action on a plain login token, naming the requirement', async () => {
    const token = await login('findir@e2e.test');

    const res = await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.detail).toContain('step-up');
    expect(res.body.detail).toContain('/auth/step-up');

    const prisma = getE2eDbClient();
    const stillOpen = await prisma.financialPeriod.findFirstOrThrow({ where: { id: periodId } });
    expect(stillOpen.status).toBe('open');
  });

  it('rejects step-up with the wrong password, with 401, and does not elevate the session', async () => {
    const token = await login('findir@e2e.test');

    await stepUp(token, 'not-the-real-password').expect(401);

    // The original token is still just a plain login token — confirms the
    // failed step-up attempt didn't somehow still elevate it.
    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows the sensitive action once stepped up, via a fresh token — the original token is unaffected', async () => {
    const token = await login('findir@e2e.test');

    const stepUpRes = await stepUp(token).expect(201);
    const elevatedToken = stepUpRes.body.accessToken;
    expect(elevatedToken).toBeDefined();
    expect(elevatedToken).not.toBe(token);

    // The ORIGINAL token is still not stepped up — step-up mints a new
    // token rather than mutating server-side state the old token benefits
    // from, consistent with this app's stateless-JWT design.
    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${elevatedToken}`)
      .expect(201);

    const prisma = getE2eDbClient();
    const closed = await prisma.financialPeriod.findFirstOrThrow({ where: { id: periodId } });
    expect(closed.status).toBe('closed');
  });

  it('also gates payroll:view_sensitive, on a lighter-weight endpoint (list payroll runs)', async () => {
    const token = await login('payrolladmin@e2e.test');

    await request(server)
      .get('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const elevatedToken = (await stepUp(token).expect(201)).body.accessToken;

    await request(server)
      .get('/api/v1/payroll-runs')
      .set('Authorization', `Bearer ${elevatedToken}`)
      .expect(200);
  });

  it('goes stale once past the real (10-minute) step-up window, even though the access token itself is still otherwise valid', async () => {
    const token = await login('findir@e2e.test');

    // Forge a token identical to a real step-up's, except its stepUpAt is
    // just past the production default window — signed with the same
    // secret env-setup.ts configures, so the server accepts it as
    // genuine. Strips the original iat/exp so jsonwebtoken computes fresh
    // ones instead of reusing (or conflicting with) the decoded ones.
    const jwt = new JwtService({ secret: 'e2e-test-access-secret-at-least-32-characters-long' });
    const { iat: _iat, exp: _exp, ...payload } = jwt.decode(token) as Record<string, unknown>;
    const staleToken = jwt.sign(
      { ...payload, stepUpAt: Date.now() - (STEP_UP_DEFAULTS.WINDOW_MS + 60_000) },
      { expiresIn: '15m' },
    );

    // The forged token's own `exp` claim is nowhere near expired — only
    // the step-up freshness window has elapsed, a separate, independent
    // check inside PermissionGuard.
    const res = await request(server)
      .post(`/api/v1/financial-periods/${periodId}/close`)
      .set('Authorization', `Bearer ${staleToken}`)
      .expect(403);
    expect(res.body.detail).toContain('step-up');

    const prisma = getE2eDbClient();
    const stillOpen = await prisma.financialPeriod.findFirstOrThrow({ where: { id: periodId } });
    expect(stillOpen.status).toBe('open');
  });

  it('does not affect an endpoint that has no step-up requirement — period:open is unaffected', async () => {
    const prisma = getE2eDbClient();
    await prisma.rolePermission.create({
      data: { role: 'finance_director', permission: 'period:open', scope: 'organization' },
    });
    const token = await login('findir@e2e.test'); // plain login, never stepped up

    await request(server)
      .post('/api/v1/financial-periods')
      .set('Authorization', `Bearer ${token}`)
      .send({ startDate: '2026-09-01', endDate: '2026-09-30' })
      .expect(201);
  });
});
