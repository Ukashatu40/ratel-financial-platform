// src/contexts/payroll/presentation/dto/reject-payroll-run.dto.ts
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RejectPayrollRunDto {
  @IsUUID()
  organizationId!: string;

  @IsNotEmpty()
  @IsString()
  reason!: string;
}
