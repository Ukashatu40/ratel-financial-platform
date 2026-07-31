// src/contexts/expense/presentation/dto/reject-expense.dto.ts
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class RejectExpenseDto {
  @IsUUID()
  organizationId!: string;

  @IsNotEmpty()
  @IsString()
  reason!: string;
}