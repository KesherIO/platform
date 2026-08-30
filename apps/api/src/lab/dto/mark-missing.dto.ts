import { IsString, IsBoolean, IsOptional, IsNotEmpty } from 'class-validator';

export class MarkSpecimenMissingDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsBoolean()
  confirm!: boolean;
}

export class ReverseSpecimenMissingDto {
  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  confirm!: boolean;
}
