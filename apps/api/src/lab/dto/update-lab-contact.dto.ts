import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PhoneNumberDto {
  /** Free text ("Recepción"); older saves hold commercial/personal/other/whatsapp */
  @IsString()
  @MaxLength(50)
  label!: string;

  @IsString()
  @MaxLength(50)
  number!: string;

  @IsBoolean()
  @IsOptional()
  whatsapp?: boolean;
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
  @ArrayMaxSize(10)
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
