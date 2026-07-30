// src/contexts/financial-period/presentation/dto/close-period.dto.ts
import { IsUUID } from 'class-validator';

export class ClosePeriodDto {
  @IsUUID()
  organizationId!: string;
}