// src/observability/observability.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health/health.controller';
import { PrismaHealthIndicator } from './health/prisma-health.indicator';
import { RedisHealthIndicator } from './health/redis-health.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator],
})
export class ObservabilityModule {}
