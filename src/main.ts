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
import multipart from '@fastify/multipart';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }), // structured logging (Phase 4.4/Phase 9) wired properly in the observability pass — Fastify's default logger is off to avoid double-logging in the meantime
  );

  await app.register(multipart as any);

  const config = app.get(ConfigService<EnvConfig>);

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

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
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

    // eslint-disable-next-line no-console
    console.log('[swagger] API docs available at /api/docs (non-production only)');
  }

  const port = config.get('PORT', { infer: true }) ?? 3000;
  await app.listen(port, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(`ratel-financial-platform listening on port ${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
