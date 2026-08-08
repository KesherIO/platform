import { IsEnum } from 'class-validator';

export class UpdateLabUserRoleDto {
  @IsEnum(['ADMIN', 'TECHNICIAN', 'MESSENGER'])
  role!: string;
}
