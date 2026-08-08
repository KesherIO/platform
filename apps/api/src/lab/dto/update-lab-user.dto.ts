import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateLabUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  /** MESSENGER only — recurring weekly availability. Shape validated in the service. */
  @IsObject()
  @IsOptional()
  schedule?: Record<string, { start: string; end: string } | null>;

  @IsBoolean()
  @IsOptional()
  canPerformPickups?: boolean;
}
