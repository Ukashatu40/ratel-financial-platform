// src/contexts/financial-period/presentation/dto/list-periods.dto.ts
import { IsIn, IsOptional } from 'class-validator';
import { PeriodStatusValue } from '../../domain/value-objects/period-status';

const STATUSES: PeriodStatusValue[] = ['open', 'closing', 'closed', 'reopened'];

export class ListPeriodsDto {
  /**
   * Optional. Validated with @IsIn so an unknown value returns a specific 400
   * from the global ValidationPipe naming the accepted values, rather than
   * reaching Prisma and surfacing as an opaque 500 — the same reasoning critical
   * convention #5 applies to domain errors.
   */
  @IsOptional()
  @IsIn(STATUSES)
  status?: PeriodStatusValue;
}
