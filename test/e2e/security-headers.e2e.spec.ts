// test/e2e/security-headers.e2e.spec.ts
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';

/**
 * Proves @fastify/helmet is actually wired in, over real HTTP — not just
 * that `app.register(helmet, ...)` appears in app.helper.ts/main.ts.
 * `GET /api/v1/health/liveness` is unauthenticated and side-effect-free,
 * same choice `cors.e2e.spec.ts` made for the identical reason: what's
 * under test is the header behaviour, not any endpoint's own logic.
 */
describe('Security headers (e2e)', () => {
  let app: NestFastifyApplication;
  let server: any;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sets standard Helmet headers on every response', async () => {
    const res = await request(server).get('/api/v1/health/liveness').expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
    // The header Fastify/Express set by default (e.g. "X-Powered-By: Express"
    // for Express apps) that Helmet's whole job is partly to strip/prevent —
    // pinned as absent so a future change can't silently reintroduce it.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('does not set Content-Security-Policy outside production — Swagger UI needs its inline scripts/CDN assets unblocked', async () => {
    // env-setup.ts sets NODE_ENV=test for the whole e2e suite, so this
    // process always runs the non-production branch — this test pins THAT
    // branch specifically, not a live NODE_ENV=production process (nothing
    // in this suite boots one).
    const res = await request(server).get('/api/v1/health/liveness').expect(200);

    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
