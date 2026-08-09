// src/observability/health/prisma-health.indicator.ts
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      // Cheapest possible real query — confirms the connection pool can
      // actually reach and query Postgres, not just that the process holds
      // an object claiming to be a client.
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (err) {
      const error = err as Error & { cause?: unknown };
      // Prisma 7's driver-adapter errors (e.g. @prisma/adapter-pg wrapping
      // a real pg connection failure) often carry the actual diagnostic
      // detail in .cause rather than .message — the same underlying
      // wrapping behavior that made the raw error message look empty here.
      // Walking .cause (one level is enough for the common case; pg's own
      // errors don't typically nest further) recovers the real reason.
      const causeMessage = error.cause instanceof Error ? error.cause.message : undefined;
      const message =
        [error.message?.trim(), causeMessage].filter(Boolean).join(' — ') ||
        'Unknown database error';

      return indicator.down({ message });
    }
  }
}
