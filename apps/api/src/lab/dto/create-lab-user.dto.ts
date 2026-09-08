import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateLabUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEnum(['ADMIN', 'TECHNICIAN', 'ANALYST', 'REVIEWER', 'DATA_ENTRY', 'MESSENGER'])
  role!: string;

  /** MESSENGER only — recurring weekly availability. Shape validated in the service. */
  @IsObject()
  @IsOptional()
  schedule?: Record<string, { start: string; end: string } | null>;

  @IsBoolean()
  @IsOptional()
  canPerformPickups?: boolean;
}
