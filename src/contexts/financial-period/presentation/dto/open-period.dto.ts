// src/contexts/financial-period/presentation/dto/open-period.dto.ts
import { IsDateString, IsUUID } from 'class-validator';

export class OpenPeriodDto {
  @IsUUID()
  organizationId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}