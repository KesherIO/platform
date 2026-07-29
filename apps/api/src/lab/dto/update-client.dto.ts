import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const CLIENT_TYPES = [
  'VETERINARY_CLINIC',
  'INDEPENDENT_VET',
  'BREEDER',
  'FARM',
  'SHELTER',
  'RESEARCH_ORGANIZATION',
  'INDIVIDUAL',
  'OTHER',
] as const;

export class UpdateClientDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsEnum(CLIENT_TYPES)
  @IsOptional()
  clientType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  primaryContactName?: string;

  @IsEmail()
  @IsOptional()
  primaryContactEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;
}
