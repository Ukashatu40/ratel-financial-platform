// src/contexts/payroll/presentation/dto/create-payroll-run.dto.ts
import { IsDateString } from 'class-validator';

export class CreatePayrollRunDto {
  @IsDateString()
  runMonth!: string;
}
