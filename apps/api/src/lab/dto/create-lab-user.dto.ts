import { LAB_ASSIGNABLE_ROLES } from '../lab-roles';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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

  @IsEnum(LAB_ASSIGNABLE_ROLES)
  role!: string;

  /** MESSENGER only — recurring weekly availability. Shape validated in the service. */
  @IsObject()
  @IsOptional()
  schedule?: Record<string, { start: string; end: string } | null>;

  @IsBoolean()
  @IsOptional()
  canPerformPickups?: boolean;

  /** RESULTS_VIEWER only — may also list orders in progress (status only) */
  @IsBoolean()
  @IsOptional()
  canViewInProgress?: boolean;

  /** Optional — stored in the membership audit log. */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
