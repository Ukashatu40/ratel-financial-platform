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
 * Which organization a failed delivery belongs to, for the org-scoped operator
 * views in TECH_DEBT #47. Deliberately identical to `AuditSubscriber`'s handling
 * of the same question — `payload['organizationId'] ?? 'unknown'` — because it is
 * the same question, and two different answers to it in the same event pipeline
 * would be the silent-drift risk #22/#37 closed.
 *
 * Every one of the 17 event factories across the three contexts does include
 * `organizationId`, so the sentinel is a guard rather than a common path. It
 * stays a sentinel and not a throw because recording a failure must never itself
 * fail: an unattributed record beats a lost one.
 */
export const organizationIdFromPayload = (payload: unknown): string => {
  const value = (payload as Record<string, unknown> | null)?.['organizationId'];
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
};

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
    organizationId: string,
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
          organizationId,
        },
        update: {
          // Back to pending_retry even from permanently_failed: a fresh failure
          // for a pair that had been given up on is a live problem again.
          status: 'pending_retry',
          attempts: { increment: 1 },
          lastError: errorMessageOf(failure.error),
          // Deliberately re-asserted on update, not only on create: a row created
          // before organizationId existed carries the 'unknown' column default,
          // and a later failure of the same pair is the natural moment to attribute
          // it correctly rather than leaving it permanently unlistable.
          organizationId,
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

  /**
   * `attempts` counts TOTAL delivery attempts ever made for this pair — the
   * original dispatch plus every redelivery, across every failure episode — and is
   * therefore written as an INCREMENT, never an absolute value.
   *
   * It was previously set absolutely from a total the processor computed as
   * `thisAttempt + 1`, which silently assumed exactly one prior delivery. That
   * holds for a pair's FIRST episode and is wrong for every later one: a pair that
   * failed, recovered and failed again reported 2 rather than 4, and an operator
   * retrying a `permanently_failed` row showing 6 watched it drop to 2 — on
   * precisely the number they were reading to judge severity. #47 made that
   * visible over HTTP, which is what turned a latent inconsistency into a
   * misleading API response.
   *
   * Incrementing produces the IDENTICAL value for the first episode (1 original +
   * 5 redeliveries = 6), so this corrects the uncovered cases without altering the
   * covered one — and makes the column monotonic, which is the property that lets
   * it be read as "how many times have we tried this".
   */
  async markRecovered(id: string): Promise<void> {
    await this.prisma.failedEventDelivery.update({
      where: { id },
      data: { status: 'recovered', attempts: { increment: 1 } },
    });
  }

  async markPermanentlyFailed(
    id: string,
    error: unknown,
    options: { countsAsAttempt?: boolean } = {},
  ): Promise<void> {
    // Every terminal failure follows a real delivery attempt EXCEPT one: the
    // "outbox event is gone, payload unrecoverable" path in EventRedeliveryService
    // never invokes the subscriber at all, so counting an attempt there would
    // inflate the very number this change exists to make trustworthy. That call
    // site is the only one that opts out.
    const countsAsAttempt = options.countsAsAttempt !== false;

    await this.prisma.failedEventDelivery.update({
      where: { id },
      data: {
        status: 'permanently_failed',
        lastError: errorMessageOf(error),
        ...(countsAsAttempt ? { attempts: { increment: 1 } } : {}),
      },
    });
  }

  async recordAttempt(id: string, error: unknown): Promise<void> {
    await this.prisma.failedEventDelivery.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: errorMessageOf(error) },
    });
  }

  logPermanentLoss(row: RecordedFailure): void {
    this.logger.error(
      `Event delivery PERMANENTLY FAILED, no more retries: subscriber "${row.subscriberName}" ` +
        `never processed ${row.eventType} (outbox event ${row.outboxEventId}). ` +
        "This event is now missing from that subscriber's downstream state.",
    );
  }
}
