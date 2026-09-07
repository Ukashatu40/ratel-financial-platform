// src/idempotency/idempotency-store.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvConfig } from '../config/env.schema';

export interface CachedResponse {
  status: number;
  body: unknown;
}

const IN_PROGRESS = 'IN_PROGRESS';

/**
 * Owns the actual Redis reads/writes behind the Idempotency-Key mechanism.
 * A dedicated connection, same posture as rate-limit.module.ts and
 * RedisHealthIndicator — every Redis-touching concern in this codebase
 * constructs its own client rather than sharing one (TECH_DEBT #19/#2
 * gotcha: unhandled 'error' crashes the process, so every client needs its
 * own listener anyway; there's no shared pool to hook into).
 */
@Injectable()
export class IdempotencyStoreService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(IdempotencyStoreService.name);

  constructor(config: ConfigService<EnvConfig>) {
    this.redis = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Idempotency Redis connection error: ${err.message}`);
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * Atomically claims `key` if nothing is currently stored under it.
   * Returns true if this call won the claim (caller should proceed to
   * execute the handler); false if something is already there — the
   * caller should then call `read()` to find out whether that's an
   * in-progress claim or a completed response to replay.
   */
  async claim(key: string, lockTtlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, IN_PROGRESS, 'PX', lockTtlMs, 'NX');
    return result === 'OK';
  }

  async read(key: string): Promise<'in-progress' | CachedResponse | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    if (raw === IN_PROGRESS) return 'in-progress';
    return JSON.parse(raw) as CachedResponse;
  }

  /** Overwrites the claim with the real response, replacing the short lock TTL with the long replay TTL. */
  async complete(key: string, response: CachedResponse, responseTtlMs: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(response), 'PX', responseTtlMs);
  }

  /** Releases a claim after a failed execution, so a genuine retry isn't stuck behind a stale lock. */
  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
