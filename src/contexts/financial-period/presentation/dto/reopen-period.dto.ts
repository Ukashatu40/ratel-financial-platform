// src/contexts/financial-period/presentation/dto/reopen-period.dto.ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReopenPeriodDto {
  /**
   * Required, and validated here as well as in the aggregate. The DTO gives the
   * caller a clean 400 from the global ValidationPipe; the aggregate guards the
   * invariant for any route that does not come through this DTO.
   *
   * `@IsNotEmpty` rejects '' but NOT '   ', which class-validator treats as
   * present — the aggregate's trim is what actually closes that gap, so this pair
   * is complementary rather than redundant.
   *
   * Capped at 500 to match the reason lengths accepted elsewhere (expense
   * rejection) and to keep an unbounded string out of the audit payload.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
