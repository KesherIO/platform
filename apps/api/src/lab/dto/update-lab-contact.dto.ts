import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PhoneNumberDto {
  @IsString()
  label!: string;

  @IsString()
  number!: string;
}

export class UpdateLabContactDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  /** ISO 3166-1 alpha-2, e.g. "CO" — default country for imported clients */
  @IsString()
  @IsOptional()
  @Matches(/^([A-Z]{2})?$/)
  country?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhoneNumberDto)
  @IsOptional()
  phoneNumbers?: PhoneNumberDto[];

  @IsNumber()
  @IsOptional()
  mapLat?: number;

  @IsNumber()
  @IsOptional()
  mapLng?: number;

  @IsString()
  @IsOptional()
  timezone?: string;
}
