// src/shared-kernel/events/failed-event-delivery.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriberFailure } from './domain-event-dispatcher';

export interface RecordedFailure {
  id: string;
  outboxEventId: string;
  eventType: string;
  subscriberName: string;
  attempts: number;
}

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Owns the `failed_event_deliveries` table — the durable record that a specific
 * subscriber did not process a specific event (TECH_DEBT #9).
 *
 * Separate from both the dispatcher (which knows nothing about persistence) and
 * the redelivery worker (which knows nothing about BullMQ-free bookkeeping),
 * matching the OutboxDispatchService/OutboxDispatchProcessor split already
 * established for the same reason: the logic stays unit-testable with a fake
 * Prisma client and zero queue infrastructure.
 */
@Injectable()
export class FailedEventDeliveryService {
  private readonly logger = new Logger(FailedEventDeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts one row per failed (event, subscriber) pair and returns them so the
   * caller can enqueue redelivery. Upsert rather than create: the unique
   * constraint on the pair means a repeat failure updates the existing row and
   * bumps `attempts`, instead of accumulating rows that make "is this still
   * broken?" unanswerable.
   */
  async recordFailures(
    outboxEventId: string,
    eventType: string,
    failures: SubscriberFailure[],
  ): Promise<RecordedFailure[]> {
    const recorded: RecordedFailure[] = [];

    for (const failure of failures) {
      const row = await this.prisma.failedEventDelivery.upsert({
        where: {
          outboxEventId_subscriberName: {
            outboxEventId,
            subscriberName: failure.subscriberName,
          },
        },
        create: {
          outboxEventId,
          eventType,
          subscriberName: failure.subscriberName,
          lastError: errorMessageOf(failure.error),
        },
        update: {
          // Back to pending_retry even from permanently_failed: a fresh failure
          // for a pair that had been given up on is a live problem again.
          status: 'pending_retry',
          attempts: { increment: 1 },
          lastError: errorMessageOf(failure.error),
        },
      });

      recorded.push({
        id: row.id,
        outboxEventId: row.outboxEventId,
        eventType: row.eventType,
        subscriberName: row.subscriberName,
        attempts: row.attempts,
      });
    }

    return recorded;
  }

  async markRecovered(id: string, totalAttempts?: number): Promise<void> {
    await this.prisma.failedEventDelivery.update({
      where: { id },
      data: {
        status: 'recovered',
        ...(totalAttempts === undefined ? {} : { attempts: totalAttempts }),
      },
    });
  }

  /**
   * `attempts` counts TOTAL delivery attempts — the original dispatch plus every
   * redelivery — because that is the number an operator reads to judge how badly
   * something is broken. Recorded here too, not just on non-final attempts,
   * otherwise a permanently-failed row freezes at the second-to-last count and
   * undercounts the very case that matters most.
   */
  async markPermanentlyFailed(id: string, error: unknown, totalAttempts?: number): Promise<void> {
    await this.prisma.failedEventDelivery.update({
      where: { id },
      data: {
        status: 'permanently_failed',
        lastError: errorMessageOf(error),
        ...(totalAttempts === undefined ? {} : { attempts: totalAttempts }),
      },
    });
  }

  async recordAttempt(id: string, totalAttempts: number, error: unknown): Promise<void> {
    await this.prisma.failedEventDelivery.update({
      where: { id },
      data: { attempts: totalAttempts, lastError: errorMessageOf(error) },
    });
  }

  logPermanentLoss(row: RecordedFailure): void {
    this.logger.error(
      `Event delivery PERMANENTLY FAILED, no more retries: subscriber "${row.subscriberName}" ` +
        `never processed ${row.eventType} (outbox event ${row.outboxEventId}). ` +
        'This event is now missing from that subscriber\'s downstream state.',
    );
  }
}
