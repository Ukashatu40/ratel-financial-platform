// src/reference-data/presentation/department.dto.ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDepartmentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string;
}

export class UpdateDepartmentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string;
}

export class ListReferenceDataDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeInactive?: boolean;
}
