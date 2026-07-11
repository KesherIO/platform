import { IsEnum } from 'class-validator';

export class UpdateLabUserRoleDto {
  @IsEnum(['ADMIN', 'TECHNICIAN', 'VET', 'RECEPTIONIST'])
  role!: string;
}
