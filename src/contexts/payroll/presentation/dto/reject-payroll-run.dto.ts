// src/contexts/payroll/presentation/dto/reject-payroll-run.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectPayrollRunDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
