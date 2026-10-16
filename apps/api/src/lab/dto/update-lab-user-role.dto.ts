import { LAB_ASSIGNABLE_ROLES } from '../lab-roles';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateLabUserRoleDto {
  @IsEnum(LAB_ASSIGNABLE_ROLES)
  role!: string;

  /** Required — stored in the membership audit log. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
