// src/contexts/payroll/presentation/dto/create-payroll-run.dto.ts
import { IsDateString, IsUUID } from 'class-validator';

export class CreatePayrollRunDto {
  @IsUUID()
  organizationId!: string;

  @IsDateString()
  runMonth!: string;
}
