// src/observability/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  /**
   * Liveness: "is the process itself alive and not deadlocked" — deliberately
   * NO dependency checks. A liveness probe failing tells an orchestrator
   * (Kubernetes, etc.) to KILL AND RESTART the pod — that's the wrong
   * response to "the database is temporarily down," which should instead
   * surface via readiness (below) so traffic stops routing here without
   * needlessly restarting a perfectly healthy process.
   */
  @Get('liveness')
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  /**
   * Readiness: "can this instance actually serve traffic right now" — checks
   * real dependencies. A failing readiness probe tells an orchestrator to
   * stop routing traffic here WITHOUT killing the process, which is the
   * correct response to a transient DB/Redis outage.
   */
  @Get('readiness')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }
}
