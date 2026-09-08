// test/e2e/rate-limiting.e2e.spec.ts
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';

/**
 * Proves the Phase 9.6 auth rate limit (TECH_DEBT — closing the
 * "no rate limiting anywhere" gap) actually fires over real HTTP against
 * real Redis, not just that the decorator/module wiring compiles.
 *
 * Every other e2e spec file shares ONE Redis instance for the whole suite
 * (global-setup.ts) and calls `POST /auth/login` from what is, to the
 * guard, the same IP — env-setup.ts sets RATE_LIMIT_AUTH_LIMIT to a huge
 * number for every file specifically so those calls never trip the guard.
 * This file deliberately overrides it back down to a real value, for
 * itself only, before booting its own app instance.
 *
 * The burst-based assertion below ("at least one 429 in N requests against
 * a limit of 3") is correct regardless of whatever count is already on the
 * shared Redis key from earlier spec files in this run — 8 new requests
 * against a limit of 3 forces at least one 429 no matter where the counter
 * started. A short TTL (2s, vs. production's 15 minutes) bounds how long
 * this file's block can affect the login calls in whichever spec runs
 * after it; afterAll waits it out with margin rather than relying on
 * Jest's own between-file overhead to cover it.
 */
describe('Rate limiting (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;

  const AUTH_LIMIT = '3';
  const AUTH_TTL_MS = '2000';

  beforeAll(async () => {
    process.env.RATE_LIMIT_AUTH_LIMIT = AUTH_LIMIT;
    process.env.RATE_LIMIT_AUTH_TTL_MS = AUTH_TTL_MS;

    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    // Let the block window this file may have triggered fully expire
    // before the next spec file's (generously-configured) logins run.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    delete process.env.RATE_LIMIT_AUTH_LIMIT;
    delete process.env.RATE_LIMIT_AUTH_TTL_MS;
  });

  it('returns 429 with a Retry-After header once the per-IP login limit is exceeded', async () => {
    const attempts = 8; // > AUTH_LIMIT, so at least one 429 is guaranteed regardless of leftover counter state
    const responses = [];
    for (let i = 0; i < attempts; i++) {
      responses.push(
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: 'nobody@e2e.test', password: 'wrong-password' }),
      );
    }

    // The hit counter behind this bucket is a single Redis key shared by
    // the WHOLE e2e run (every spec file's `loginAs()` increments the same
    // key, keyed only by class+handler+IP — not by whatever limit was
    // configured at call time). So exactly how many of these 8 requests
    // land before the block triggers is NOT deterministic — earlier spec
    // files may have already pushed the counter well past 3, in which case
    // every request in this burst is blocked from the first one. What IS
    // guaranteed regardless of that leftover state: 8 requests against a
    // limit of 3 always exceeds it by the last request, so the final
    // response in the burst is always 429 — that's what this test pins,
    // rather than assuming an early "not yet blocked" window exists.
    const last = responses[responses.length - 1];
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
    // RFC 7807 (ProblemDetailsFilter) — ThrottlerException is a plain
    // HttpException, so it falls through the filter's generic branch
    // rather than the DomainError one, but the shape is still Problem
    // Details, not NestJS's raw default error body.
    expect(last.body).toMatchObject({
      status: 429,
      type: expect.stringContaining('/errors/'),
    });

    // Any response that ISN'T throttled must be a normal login failure
    // (401), not something the guard let through malformed or swallowed —
    // this holds whether or not any such response actually occurred.
    for (const res of responses) {
      if (res.status !== 429) expect(res.status).toBe(401);
    }
  });
});
