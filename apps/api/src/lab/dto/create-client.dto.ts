import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const CLIENT_TYPES = [
  'VETERINARY_CLINIC',
  'INDEPENDENT_VET',
  'BREEDER',
  'FARM',
  'SHELTER',
  'RESEARCH_ORGANIZATION',
  'INDIVIDUAL',
  'OTHER',
] as const;

const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * Field rules for a new client, shared by Add client (CreateClientDto) and
 * each bulk import row (ImportClientRowDto) so the two can't drift apart.
 *
 * Whether taxIdType fits the country, and whether a taxId has the type and
 * country it needs, is checked by checkTaxIdentity() (client-import.util.ts):
 * those rules depend on more than one field.
 */
export class ClientFieldsDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEnum(CLIENT_TYPES)
  clientType!: string;

  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  primaryContactName?: string;

  @Trim()
  @IsEmail()
  @MaxLength(254)
  primaryContactEmail!: string;

  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  /** ISO 3166-1 alpha-2, e.g. "CO" */
  @Trim()
  @IsString()
  @IsOptional()
  @Matches(/^([A-Z]{2})?$/)
  country?: string;

  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  legalName?: string;

  /** e.g. "NIT", "RUT" — see shared-types tax-id-type.model.ts */
  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(20)
  taxIdType?: string;

  /** As entered, e.g. "900.123.456-7" */
  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(50)
  taxId?: string;

  /** Lab-internal, stored on this lab's connection only */
  @Trim()
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  notes?: string;
}

export class CreateClientDto extends ClientFieldsDto {}
