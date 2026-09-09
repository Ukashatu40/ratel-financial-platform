// test/e2e/cors.e2e.spec.ts
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';

/**
 * Proves CORS support actually works over real HTTP, not just that
 * parseCorsOrigins()/buildCorsOptions() return the right shape in
 * isolation (that's covered at the unit layer). `GET /api/v1/health/
 * liveness` is unauthenticated and side-effect-free, so it's used as the
 * plain request every case here hangs off of — what's under test is the
 * CORS header behaviour, not any particular endpoint's own logic.
 *
 * `CORS_ORIGINS` is overridden via `process.env` before `createTestApp()`
 * in `beforeAll`, the same per-file pattern `rate-limiting.e2e.spec.ts`
 * uses for its own env override — this one works because CORS, like the
 * rate limiter's 'default' throttler, is registered once at boot
 * (`app.register(cors, ...)` in app.helper.ts), not read fresh per
 * request the way `step-up.e2e.spec.ts` found `PermissionGuard`'s
 * `ConfigService` read to be.
 */
describe('CORS (e2e)', () => {
  describe('when CORS_ORIGINS is configured with an explicit allowlist', () => {
    let app: NestFastifyApplication;
    let server: any;

    beforeAll(async () => {
      process.env.CORS_ORIGINS = 'https://allowed.example.com';
      app = await createTestApp();
      server = app.getHttpServer();
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CORS_ORIGINS;
    });

    it('reflects an allowed origin in Access-Control-Allow-Origin', async () => {
      const res = await request(server)
        .get('/api/v1/health/liveness')
        .set('Origin', 'https://allowed.example.com')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
    });

    it('does not grant a disallowed origin', async () => {
      const res = await request(server)
        .get('/api/v1/health/liveness')
        .set('Origin', 'https://not-allowed.example.com')
        .expect(200); // the server still answers — CORS is enforced by the BROWSER reading the missing header, not a server-side block

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not send Access-Control-Allow-Credentials — CORS_CREDENTIALS defaults to false, matching the bearer-token-only auth model', async () => {
      const res = await request(server)
        .get('/api/v1/health/liveness')
        .set('Origin', 'https://allowed.example.com')
        .expect(200);

      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('when CORS_ORIGINS is unset — the default', () => {
    let app: NestFastifyApplication;
    let server: any;

    beforeAll(async () => {
      delete process.env.CORS_ORIGINS;
      app = await createTestApp();
      server = app.getHttpServer();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('never sends Access-Control-Allow-Origin, for any origin — CORS is fully disabled by default', async () => {
      const res = await request(server)
        .get('/api/v1/health/liveness')
        .set('Origin', 'https://anything.example.com')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
