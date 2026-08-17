// src/integration/presentation/dto/save-column-mapping.dto.ts
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class SaveColumnMappingDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsObject()
  mapping!: Record<string, string>; // e.g. { department: "Dept", category: "Cost Category", amountMinorUnits: "Amount", currency: "Curr", expenseDate: "Txn Date" }
}
