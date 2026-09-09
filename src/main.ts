// src/main.ts
import './tracing';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './shared-kernel/errors/problem-details.filter';
import { EnvConfig } from './config/env.schema';
import { buildCorsOptions } from './config/cors.config';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }), // structured logging (Phase 4.4/Phase 9) wired properly in the observability pass — Fastify's default logger is off to avoid double-logging in the meantime
  );

  // Without this, a SIGTERM (what every container orchestrator sends on a
  // rolling deploy/restart) kills the process immediately — PrismaService's
  // and IdempotencyStoreService's own OnModuleDestroy hooks (DB pool /
  // Redis disconnect) already exist but were never being called, and
  // Fastify's own close() (which drains in-flight requests instead of
  // dropping them mid-response) never got a chance to run either.
  app.enableShutdownHooks();

  await app.register(multipart);

  const config = app.get(ConfigService<EnvConfig>);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  // CORS_ORIGINS unset -> parseCorsOrigins() returns false -> @fastify/cors
  // sends no Access-Control-Allow-Origin header at all, i.e. disabled.
  // Registered before routes (this is the only place any register() call
  // happens before app.listen()), matching @fastify/cors's own requirement
  // that it run ahead of the routes it needs to decorate.
  await app.register(cors, buildCorsOptions(
    config.get('CORS_ORIGINS', { infer: true }),
    config.get('CORS_CREDENTIALS', { infer: true }) ?? false,
  ));

  // Standard security headers (HSTS, X-Content-Type-Options, X-Frame-Options,
  // etc.) — this app is a pure JSON API with no HTML surface in production
  // (Swagger is non-production only, gated below), so Helmet's defaults have
  // nothing of ours to conflict with there. Content-Security-Policy is the
  // one exception, and only outside production: it's meant to constrain a
  // PAGE's own scripts/styles, and Swagger UI's inline scripts and CDN-hosted
  // assets would fail Helmet's default CSP directives. Disabling CSP where
  // Swagger is the only HTML this app ever serves isn't a weakening of
  // anything actually protected in production.
  await app.register(helmet, {
    contentSecurityPolicy: isProduction ? undefined : false,
  });

  // RFC 7807 everywhere (Phase 5.7 / 7.6) — single global filter, no per-controller opt-in
  app.useGlobalFilters(new ProblemDetailsFilter());

  // whitelist: true / forbidNonWhitelisted: true — reject unknown fields
  // outright rather than silently dropping them (Phase 9.5)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // URI versioning per Phase 4.4 decision — /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ratel Financial Platform API')
      .setDescription(
        'Expense management, payroll, financial periods, reporting, and integration API for Ratel-Plus Nigeria Ltd.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token', // reference name used by @ApiBearerAuth('access-token') below
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);

    console.log('[swagger] API docs available at /api/docs (non-production only)');
  }

  const port = config.get('PORT', { infer: true }) ?? 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`ratel-financial-platform listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
