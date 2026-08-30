// src/audit-log/application/chain-verifier.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeEntryHash,
  computeEntryHashV2,
  GENESIS_HASH,
} from '../../shared-kernel/audit/hash-chain.util';

/**
 * Recomputes every entry's hash from its own stored content and confirms it links
 * correctly to the entry before it — the check `hash-chain.util.ts`'s own comment
 * has claimed existed since #7, and #9's incident (a silently-lost audit entry,
 * caught only because the chain would eventually go missing an entry — except a
 * missing entry alone doesn't break linkage, which is exactly the caveat below)
 * showed nothing ever actually ran it.
 *
 * Lives here, not in `src/shared-kernel/audit/`, for the same reason
 * `AuditLogController` does: verification READS existing rows and reports on them,
 * it writes nothing, so it belongs in the supporting module, not the kernel that
 * owns writing the trail.
 */
export type ChainMismatchReason = 'linkage' | 'content' | 'unrecognized-version';

export interface ChainVerificationResult {
  organizationId: string;
  entriesChecked: number;
  valid: boolean;
  /** The row whose hash does not match its recomputed content, or whose prevHash
   * does not match the entry before it. Null when valid is true. */
  firstMismatchId: string | null;
  firstMismatchReason: ChainMismatchReason | null;
  /**
   * Stated in the response itself, not only in code comments (#26/#29's pattern):
   * this proves entries were not ALTERED. It cannot prove none are MISSING — a
   * chain with a row deleted and every subsequent hash recomputed to match is
   * still internally consistent. The same gap #47 records for a permanently-lost
   * event-delivery record.
   */
  caveat: string;
}

const CAVEAT =
  'This verification proves entries were not altered after being written. It ' +
  'cannot prove no entries are missing: a chain with a row deleted and every ' +
  'subsequent hash recomputed to match would still pass this check.';

@Injectable()
export class ChainVerifierService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(organizationId: string): Promise<ChainVerificationResult> {
    const rows = await this.prisma.auditLogEntry.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    let expectedPrevHash = GENESIS_HASH;

    for (const row of rows) {
      // LINKAGE check, separate from and prior to the content check: this row's
      // stored prevHash must equal the PRECEDING row's actual entryHash. Editing a
      // row's content and recomputing its OWN hash to match (so the content check
      // below would pass) still breaks the NEXT row's linkage to it, since that
      // next row's prevHash still points at the original, now-superseded hash.
      // Checking linkage independently is what catches that case.
      if (row.prevHash !== expectedPrevHash) {
        return this.mismatch(organizationId, rows.length, row.id, 'linkage');
      }

      let recomputed: string;
      if (row.hashVersion === 1) {
        recomputed = computeEntryHash(row.prevHash, {
          organizationId: row.organizationId,
          entityType: row.entityType,
          entityId: row.entityId,
          action: row.action,
          actorUserId: row.actorUserId,
          correlationId: row.correlationId,
          createdAt: row.createdAt,
        });
      } else if (row.hashVersion === 2) {
        recomputed = computeEntryHashV2(row.prevHash, {
          organizationId: row.organizationId,
          entityType: row.entityType,
          entityId: row.entityId,
          action: row.action,
          actorUserId: row.actorUserId,
          correlationId: row.correlationId,
          createdAt: row.createdAt,
          oldValue: row.oldValue,
          newValue: row.newValue,
          reason: row.reason ?? undefined,
        });
      } else {
        // Only 1 and 2 have ever been written (default 1, CURRENT_HASH_VERSION 2).
        // A different value means the row itself is corrupt in a way no hash
        // function can verify — fail rather than guess which scheme to apply.
        return this.mismatch(organizationId, rows.length, row.id, 'unrecognized-version');
      }

      if (recomputed !== row.entryHash) {
        return this.mismatch(organizationId, rows.length, row.id, 'content');
      }

      expectedPrevHash = row.entryHash;
    }

    return {
      organizationId,
      entriesChecked: rows.length,
      valid: true,
      firstMismatchId: null,
      firstMismatchReason: null,
      caveat: CAVEAT,
    };
  }

  private mismatch(
    organizationId: string,
    entriesChecked: number,
    rowId: string,
    reason: ChainMismatchReason,
  ): ChainVerificationResult {
    return {
      organizationId,
      entriesChecked,
      valid: false,
      firstMismatchId: rowId,
      firstMismatchReason: reason,
      caveat: CAVEAT,
    };
  }
}
