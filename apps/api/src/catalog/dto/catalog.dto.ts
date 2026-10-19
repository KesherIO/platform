import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BILLING_CODE_MAX_LENGTH } from '../../billing/billing-code.util';

export enum CatalogItemKindDto {
  TEST = 'TEST',
  PACKAGE = 'PACKAGE',
}

export enum ResultTypeDto {
  NUMERIC = 'NUMERIC',
  TEXT = 'TEXT',
  POSITIVE_NEGATIVE = 'POSITIVE_NEGATIVE',
}

export class ImportCatalogItemDto {
  @ApiProperty({ enum: CatalogItemKindDto })
  @IsEnum(CatalogItemKindDto)
  kind!: CatalogItemKindDto;

  @ApiProperty({ example: 'Complete Blood Count' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    example: 'CBC',
    description: 'Lab code — upsert key when present',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    example: 'HEM',
    description:
      "The lab's billing-system code. Omit to keep the item's current one.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(BILLING_CODE_MAX_LENGTH)
  billingCode?: string;

  @ApiPropertyOptional({ example: 'Hematology' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  turnaroundHours?: number;

  @ApiPropertyOptional({ enum: ResultTypeDto, example: ResultTypeDto.NUMERIC })
  @IsOptional()
  @IsEnum(ResultTypeDto)
  resultType?: ResultTypeDto;

  @ApiPropertyOptional({
    example: 'mg/dL',
    description: 'Unit of measurement for NUMERIC results',
  })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 'Comprehensive annual wellness screening' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: ['CBC', 'BMP'],
    description: 'PACKAGE only — codes of constituent tests',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  componentCodes?: string[];
}

export class ImportCatalogDto {
  @ApiProperty({ description: 'Which lab this catalog import belongs to' })
  @IsString()
  @IsNotEmpty()
  labTenantId!: string;

  @ApiProperty({ type: [ImportCatalogItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCatalogItemDto)
  items!: ImportCatalogItemDto[];

  @ApiPropertyOptional({
    default: false,
    deprecated: true,
    description:
      'UNSUPPORTED — true is rejected with a 400 before anything is deleted. ' +
      'Replacing a catalog would orphan items that past orders, cases and billing codes use. ' +
      'Import without it (upsert) and disable items you no longer offer.',
  })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

// ---------------------------------------------------------------------------
// Admin CRUD (lab-scoped — see LabTenantGuard on the controller routes)
// ---------------------------------------------------------------------------

export enum CatalogSortDto {
  NAME_ASC = 'name_asc',
  NAME_DESC = 'name_desc',
  CREATED_DESC = 'created_desc',
  CREATED_ASC = 'created_asc',
}

export class ListCatalogAdminDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: CatalogItemKindDto })
  @IsOptional()
  @IsEnum(CatalogItemKindDto)
  kind?: CatalogItemKindDto;

  @ApiPropertyOptional({ enum: CatalogSortDto })
  @IsOptional()
  @IsEnum(CatalogSortDto)
  sort?: CatalogSortDto;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number;
}

export class CreateCatalogItemDto {
  @ApiProperty({ enum: CatalogItemKindDto })
  @IsEnum(CatalogItemKindDto)
  kind!: CatalogItemKindDto;

  @ApiProperty({ example: 'Complete Blood Count' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'CBC' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    example: 'HEM',
    description: "The lab's billing code",
  })
  @IsOptional()
  @IsString()
  @MaxLength(BILLING_CODE_MAX_LENGTH)
  billingCode?: string;

  @ApiPropertyOptional({
    description:
      'TEST only — the test exists only as part of packages: hidden from clinics, still available to the lab',
  })
  @IsOptional()
  @IsBoolean()
  packageComponentOnly?: boolean;

  @ApiPropertyOptional({ example: 'Hematology' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  turnaroundHours?: number;

  @ApiPropertyOptional({ enum: ResultTypeDto, example: ResultTypeDto.NUMERIC })
  @IsOptional()
  @IsEnum(ResultTypeDto)
  resultType?: ResultTypeDto;

  @ApiPropertyOptional({ example: 'mg/dL' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 'Comprehensive annual wellness screening' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'PACKAGE only — ids of constituent tests (must belong to the same lab)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  componentIds?: string[];
}

export class UpdateCatalogItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    description: "The lab's billing code. Empty string clears it.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(BILLING_CODE_MAX_LENGTH)
  billingCode?: string | null;

  @ApiPropertyOptional({
    description:
      'TEST only — the test exists only as part of packages: hidden from clinics, still available to the lab and inside packages',
  })
  @IsOptional()
  @IsBoolean()
  packageComponentOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  turnaroundHours?: number;

  @ApiPropertyOptional({ enum: ResultTypeDto })
  @IsOptional()
  @IsEnum(ResultTypeDto)
  resultType?: ResultTypeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'PACKAGE only — ids of constituent tests (must belong to the same lab). ' +
      'Omit to leave composition unchanged; pass [] to clear it.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  componentIds?: string[];
}
