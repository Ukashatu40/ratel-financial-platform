// src/audit-log/presentation/dto/list-audit-entries.dto.ts
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * Every filter is validated at the boundary rather than passed through to Prisma.
 *
 * The global pipe runs with `whitelist: true, forbidNonWhitelisted: true`, so a query
 * parameter not declared here is rejected with a 400 naming it — a typo'd filter
 * fails loudly instead of being silently ignored and returning a wider result set
 * than the caller believes they asked for.
 *
 * `@Type(() => Number)` is required on the numeric fields: the pipe sets
 * `transform: true` but NOT `enableImplicitConversion`, so query strings arrive as
 * strings and `@IsInt` would reject them. Same convention as `ListExpensesDto`.
 */
export class ListAuditEntriesDto {
  /**
   * Deliberately NOT `@IsIn` over a fixed list. Entity types come from each event's
   * `aggregateType` and the reference-data context contributes its own, so a closed
   * enum here would silently stop matching whenever a new auditable type is added —
   * failing in the direction of returning nothing, which looks like "no history".
   */
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  /** The domain event type, e.g. 'PeriodReopened'. Same open-set reasoning as entityType. */
  @IsOptional()
  @IsString()
  action?: string;

  /** Inclusive lower bound on createdAt. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on createdAt. */
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /**
   * Capped at 500. An audit trail grows without bound, so unlike the operator views
   * in #47 this genuinely needs paging rather than a fixed `take: 100` — but an
   * uncapped limit would let one request try to serialize the entire history.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
