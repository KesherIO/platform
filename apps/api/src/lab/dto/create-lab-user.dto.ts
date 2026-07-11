import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateLabUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEnum(['ADMIN', 'TECHNICIAN', 'VET', 'RECEPTIONIST'])
  role!: string;
}
