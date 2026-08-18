// src/reporting/presentation/dto/top-n.dto.ts
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DateRangeDto } from './date-range.dto';

export class TopNDto extends DateRangeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number;
}
