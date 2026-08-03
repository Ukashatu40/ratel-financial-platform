// src/contexts/payroll/presentation/dto/add-payslip.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { SalaryLineItemDto } from './salary-line-item.dto';

export class AddPayslipDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryLineItemDto)
  additionalLineItems?: SalaryLineItemDto[];
}
