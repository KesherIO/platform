import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
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

export class CreateClientDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsEnum(CLIENT_TYPES)
  clientType!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  primaryContactName?: string;

  @IsEmail()
  primaryContactEmail!: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  /** ISO 3166-1 alpha-2, e.g. "CO" */
  @IsString()
  @IsOptional()
  @Matches(/^([A-Z]{2})?$/)
  country?: string;
}
