// src/contexts/expense/presentation/dto/create-expense.dto.ts
// (remove organizationId)
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

const SUPPORTED_SOURCE_TYPES = ['manual', 'employee', 'accountant'] as const;

export class CreateExpenseDto {
  @IsIn(SUPPORTED_SOURCE_TYPES)
  sourceType!: (typeof SUPPORTED_SOURCE_TYPES)[number];

  // import/integration sources go through the ACL mapper (Phase 3.3/8),
  // never through this human-facing endpoint directly — hence the
  // restricted @IsIn set above rather than accepting ExpenseSourceType wholesale.

  @IsPositive()
  amountMinorUnits!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsUUID()
  categoryId!: string;

  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsDateString()
  expenseDate!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
