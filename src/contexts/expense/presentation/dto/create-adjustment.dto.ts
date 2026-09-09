// src/contexts/expense/presentation/dto/create-adjustment.dto.ts
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class CreateAdjustmentDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;

  // The corrected total this expense should have been — NOT a delta.
  // Zero is valid (a full reversal/void); negative is rejected here at the
  // boundary rather than surfacing as the aggregate's DomainError, per
  // Phase 9.5 (invalid shapes never reach the application layer). The
  // aggregate (Expense.createAdjustment()) still enforces the same floor
  // independently — this DTO check is the fast, specific-400 path, not the
  // only one.
  @IsInt()
  @Min(0)
  newAmountMinorUnits!: number;
}