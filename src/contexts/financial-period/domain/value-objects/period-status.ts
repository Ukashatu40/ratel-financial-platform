// src/contexts/financial-period/domain/value-objects/period-status.ts
/**
 * Domain owns its own enum — never imports the Prisma-generated enum
 * directly (that would violate the hexagonal dependency rule from
 * Phase 4.3: domain/ must not know infrastructure exists). The Prisma
 * repository maps between the two at the boundary.
 */
export type PeriodStatusValue = 'open' | 'closing' | 'closed' | 'reopened';

export const OPEN_STATUSES: readonly PeriodStatusValue[] = ['open', 'reopened'];