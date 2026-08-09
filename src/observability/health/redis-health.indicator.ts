// src/observability/health/redis-health.indicator.ts
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvConfig } from '../../config/env.schema';

@Injectable()
export class RedisHealthIndicator {
  private client: Redis | null = null;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(ConfigService) private readonly config: ConfigService<EnvConfig>,
  ) {}

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis({
        host: this.config.get('REDIS_HOST', { infer: true }),
        port: this.config.get('REDIS_PORT', { infer: true }),
        lazyConnect: true,
        maxRetriesPerRequest: 1, // health checks should fail fast, not hang
      });
      // Same node-postgres-adjacent lesson from earlier in this build
      // applies to ioredis too — an unhandled 'error' event on a Redis
      // client crashes the process the same way an unhandled pg.Pool
      // error did (TECH_DEBT #19). Never skip this.
      this.client.on('error', () => {
        /* swallowed deliberately — ping() below will surface the failure
           through the health check response itself; this listener exists
           solely to prevent an unhandled-error crash, not to log */
      });
    }
    return this.client;
  }

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.getClient().ping();
      return indicator.up();
    } catch (err) {
      const error = err as Error & { cause?: unknown };
      const causeMessage = error.cause instanceof Error ? error.cause.message : undefined;
      const message =
        [error.message?.trim(), causeMessage].filter(Boolean).join(' — ') || 'Unknown Redis error';

      return indicator.down({ message });
    }
  }
}
