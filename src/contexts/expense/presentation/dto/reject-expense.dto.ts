// src/contexts/expense/presentation/dto/reject-expense.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectExpenseDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
