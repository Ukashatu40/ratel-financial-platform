// src/auth/presentation/dto/step-up.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class StepUpDto {
  @IsNotEmpty()
  @IsString()
  password!: string;
}
