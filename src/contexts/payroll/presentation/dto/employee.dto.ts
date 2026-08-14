// src/contexts/payroll/presentation/dto/employee.dto.ts
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class CreateEmployeeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  fullName!: string;
}

export class LinkUserDto {
  @IsUUID()
  userId!: string;
}

export class ListEmployeesDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeInactive?: boolean;
}
