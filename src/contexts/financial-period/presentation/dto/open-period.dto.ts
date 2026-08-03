// src/contexts/financial-period/presentation/dto/open-period.dto.ts
import { IsDateString } from 'class-validator';

export class OpenPeriodDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
