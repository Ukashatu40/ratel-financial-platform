// src/observability/health/redis-health.indicator.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvConfig } from '../../config/env.schema';
import { collectErrorChainMessages } from '../../shared-kernel/errors/error-chain.util';

@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);
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
      this.logger.error('Redis health check failed', err instanceof Error ? err.stack : err);

      const chainMessages = collectErrorChainMessages(err);
      const message = chainMessages.length > 0 ? chainMessages.join(' — ') : 'Unknown Redis error';

      return indicator.down({ message });
    }
  }
}
