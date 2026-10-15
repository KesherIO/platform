import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateBy,
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

/** The clinic app has one "Chat on WhatsApp" button, so one WhatsApp number. */
const AtMostOneWhatsApp = () =>
  ValidateBy({
    name: 'atMostOneWhatsApp',
    validator: {
      validate: (phones: unknown) =>
        !Array.isArray(phones) ||
        phones.filter(
          (p) =>
            p !== null &&
            typeof p === 'object' &&
            (p as Record<string, unknown>)['whatsapp'] === true
        ).length <= 1,
      defaultMessage: () => 'only one phone number can be WhatsApp',
    },
  });

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
  @AtMostOneWhatsApp()
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
