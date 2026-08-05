// test/e2e/setup/app.helper.ts
import { Test } from '@nestjs/testing';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';
import { ProblemDetailsFilter } from '../../../src/shared-kernel/errors/problem-details.filter';

/**
 * Mirrors main.ts's bootstrap exactly (global filter, validation pipe,
 * versioning) — an e2e test is only meaningful if the app under test is
 * configured identically to how it actually runs in production/dev.
 * Diverging here would mean "passing e2e tests" don't actually prove the
 * real app works.
 */
export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

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
