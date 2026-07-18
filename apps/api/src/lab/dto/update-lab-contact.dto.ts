import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
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
}
