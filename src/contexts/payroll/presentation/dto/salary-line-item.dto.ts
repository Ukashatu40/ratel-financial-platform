// src/contexts/payroll/presentation/dto/salary-line-item.dto.ts
import { IsIn, IsPositive, IsString } from 'class-validator';

export class SalaryLineItemDto {
  @IsIn(['allowance', 'deduction', 'loan_repayment'])
  kind!: 'allowance' | 'deduction' | 'loan_repayment';

  @IsString()
  label!: string;

  @IsPositive()
  amountMinorUnits!: number;
}
