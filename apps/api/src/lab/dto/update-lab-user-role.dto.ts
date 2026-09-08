import { IsEnum } from 'class-validator';

export class UpdateLabUserRoleDto {
  @IsEnum([
    'ADMIN',
    'TECHNICIAN',
    'ANALYST',
    'REVIEWER',
    'DATA_ENTRY',
    'MESSENGER',
  ])
  role!: string;
}
