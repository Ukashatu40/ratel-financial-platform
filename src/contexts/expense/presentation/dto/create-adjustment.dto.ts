// src/contexts/expense/presentation/dto/create-adjustment.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateAdjustmentDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}