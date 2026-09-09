// test/e2e/setup/app.helper.ts
import { Test } from '@nestjs/testing';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../../src/app.module';
import { ProblemDetailsFilter } from '../../../src/shared-kernel/errors/problem-details.filter';
import { EnvConfig } from '../../../src/config/env.schema';
import { buildCorsOptions } from '../../../src/config/cors.config';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

/**
 * Mirrors main.ts's bootstrap exactly (global filter, validation pipe,
 * versioning, CORS, security headers) — an e2e test is only meaningful if
 * the app under test is configured identically to how it actually runs in
 * production/dev. Diverging here would mean "passing e2e tests" don't
 * actually prove the real app works.
 *
 * Deliberately NOT mirrored: main.ts's `app.enableShutdownHooks()`. That
 * wires OS signal (SIGTERM/SIGINT) listeners, which has nothing to do with
 * app configuration parity — registering OS-level signal handlers once per
 * Jest test file would leak listeners across this suite's many
 * `createTestApp()` calls for no benefit, since `afterAll`'s `app.close()`
 * already invokes the same lifecycle hooks directly.
 */
export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  await app.register(multipart as any); // <-- was missing; must mirror main.ts's bootstrap() exactly

  const config = app.get(ConfigService<EnvConfig>);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  await app.register(
    cors,
    buildCorsOptions(
      config.get('CORS_ORIGINS', { infer: true }),
      config.get('CORS_CREDENTIALS', { infer: true }) ?? false,
    ),
  );

  await app.register(helmet, {
    contentSecurityPolicy: isProduction ? undefined : false,
  });

  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();
  await app.getHttpAdapter().getInstance().ready(); // Fastify-specific: must be ready before supertest can hit it

  return app;
}
