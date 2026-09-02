// src/contexts/payroll/presentation/dto/salary-structure.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SalaryLineItemDto {
  @IsIn(['allowance', 'deduction', 'loan_repayment'])
  kind!: 'allowance' | 'deduction' | 'loan_repayment';

  @IsString()
  label!: string;

  @IsInt()
  @Min(1)
  amountMinorUnits!: number;
}

export class CreateSalaryStructureDto {
  @IsISO8601()
  effectiveFrom!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalaryLineItemDto)
  baseSalaryLineItems!: SalaryLineItemDto[];
}
