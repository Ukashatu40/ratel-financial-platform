// src/contexts/expense/presentation/dto/list-expenses.dto.ts
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'cancelled',
  'closed',
] as const;

export class ListExpensesDto {
  @IsOptional()
  @IsArray()
  @IsIn(STATUSES, { each: true })
  @Type(() => String)
  status?: (typeof STATUSES)[number][];

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}
