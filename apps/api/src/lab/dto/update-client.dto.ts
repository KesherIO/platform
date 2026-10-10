import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { CLIENT_TYPES } from './create-client.dto';

/**
 * Shared clinic profile fields follow the same rule as every profile writer
 * (see tenants/clinic-profile.util.ts): omitted → preserved, null or '' →
 * cleared. `name` and `primaryContactEmail` may be omitted but never cleared,
 * so they reject null instead of using @IsOptional (which accepts null).
 */
export class UpdateClientDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsEnum(CLIENT_TYPES)
  @IsOptional()
  clientType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  primaryContactName?: string | null;

  @ValidateIf((_o, v) => v !== undefined)
  @IsEmail()
  primaryContactEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string | null;

  /** ISO 3166-1 alpha-2, e.g. "CO" — '' or null clears it */
  @IsString()
  @IsOptional()
  @Matches(/^([A-Z]{2})?$/)
  country?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  legalName?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  taxIdType?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  taxId?: string | null;

  /** Lab-internal, stored on this lab's connection only — '' or null clears it */
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  notes?: string | null;
}
