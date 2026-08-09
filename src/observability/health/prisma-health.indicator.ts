// src/observability/health/prisma-health.indicator.ts
import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';
import { collectErrorChainMessages } from '../../shared-kernel/errors/error-chain.util';

@Injectable()
export class PrismaHealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (err) {
      // Full-fidelity error ALWAYS goes to server logs, independent of
      // whatever the HTTP response manages to summarize — this is the
      // actual source of truth for an engineer debugging a real incident,
      // not the best-effort client-facing message below.
      this.logger.error('Database health check failed', err instanceof Error ? err.stack : err);

      const chainMessages = collectErrorChainMessages(err);
      const message =
        chainMessages.length > 0 ? chainMessages.join(' — ') : 'Unknown database error';

      return indicator.down({ message });
    }
  }
}
