// src/rate-limit/rate-limit.module.ts
import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigModule } from '../config/config.module';
import { EnvConfig } from '../config/env.schema';
import { RATE_LIMIT_DEFAULTS } from './rate-limit.constants';

const logger = new Logger('RateLimitRedis');

/**
 * Single named 'default' throttler, applied globally via APP_GUARD and
 * tracked per-IP (the library's own default `getTracker`, unchanged) —
 * covers the whole API as a baseline. `auth.controller.ts` and
 * `reports.controller.ts` override it with stricter limits per Phase 9.6
 * via `@Throttle({ default: {...} })`, rather than this module defining
 * separate named throttlers for them: `ThrottlerGuard` runs EVERY
 * configured named throttler against EVERY route unless explicitly
 * skipped (its Redis bucket key is per-handler, but the LIMIT enforced on
 * an unrelated route would still be the named throttler's own), so a
 * second/third named throttler left unskipped would silently cap ordinary
 * endpoints at the auth/reports limit too. A single throttler with
 * per-route overrides avoids that without sprinkling `@SkipThrottle()`
 * across every other controller.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig>): ThrottlerModuleOptions => {
        // Passing RedisOptions (rather than a pre-built client) so
        // ThrottlerStorageRedisService owns the connection itself:
        // `disconnectRequired` is only set true on this constructor path,
        // which is what makes its own `onModuleDestroy()` actually
        // disconnect on app shutdown — Nest calls that hook on whatever
        // `storage` instance is returned here regardless of how it was
        // constructed. Passing our own pre-built client left the
        // connection open past `app.close()` (visible as e2e's "Jest did
        // not exit" warning) since that path leaves `disconnectRequired`
        // unset.
        const storage = new ThrottlerStorageRedisService({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
        });
        // Same lesson as RedisHealthIndicator / TECH_DEBT #19 — an
        // unhandled 'error' event on an ioredis client crashes the whole
        // process. Logged rather than swallowed: unlike the health
        // indicator's client, this one sits on the request path for
        // nearly every endpoint, so a connection problem here is an
        // operational event worth seeing, not just a ping failure.
        storage.redis.on('error', (err: Error) => {
          logger.warn(`Rate-limit Redis connection error: ${err.message}`);
        });

        return {
          throttlers: [
            {
              name: 'default',
              ttl: config.get('RATE_LIMIT_DEFAULT_TTL_MS', { infer: true }) ?? RATE_LIMIT_DEFAULTS.DEFAULT_TTL_MS,
              limit: config.get('RATE_LIMIT_DEFAULT_LIMIT', { infer: true }) ?? RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT,
            },
          ],
          storage,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
