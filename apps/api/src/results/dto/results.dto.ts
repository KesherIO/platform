import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export enum AnalyteValueTypeDto {
  NUMERIC = 'NUMERIC',
  TEXT = 'TEXT',
  POSITIVE_NEGATIVE = 'POSITIVE_NEGATIVE',
  SELECT = 'SELECT',
}

export enum PatientSpeciesDto {
  DOG = 'DOG',
  CAT = 'CAT',
  EQUINE = 'EQUINE',
  BOVINE = 'BOVINE',
  BIRD = 'BIRD',
  REPTILE = 'REPTILE',
  RABBIT = 'RABBIT',
  OTHER = 'OTHER',
  ANY = 'ANY', // species-agnostic — applies to all species
}

// ---------------------------------------------------------------------------
// POST /results/templates
// Import (upsert) a result template — Biomet internal only.
// Analytes always belong to a section. For templates with no logical grouping,
// send one section with an empty name.
// ---------------------------------------------------------------------------

export class ReferenceRangeDto {
  @ApiPropertyOptional({ example: 5.5 })
  @IsOptional()
  @IsNumber()
  min?: number;

  @ApiPropertyOptional({ example: 8.5 })
  @IsOptional()
  @IsNumber()
  max?: number;

  @ApiProperty({ example: '5.50 – 8.50' })
  @IsString()
  @IsNotEmpty()
  displayText!: string;
}

export class ImportTemplateAnalyteDto {
  @ApiProperty({
    example: 'WBC',
    description: 'Stable semantic code — AI + machine import anchor',
  })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 'Recuento total de leucocitos (WBC)' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Impedancia eléctrica' })
  @IsOptional()
  @IsString()
  technique?: string;

  @ApiProperty({ enum: AnalyteValueTypeDto })
  @IsEnum(AnalyteValueTypeDto)
  valueType!: AnalyteValueTypeDto;

  @ApiPropertyOptional({ example: '10^3/µL' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Amarillo', 'Naranja', 'Rojo'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0)
  sortOrder!: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Bold label row — no value input',
  })
  @IsOptional()
  @IsBoolean()
  isHeader?: boolean;

  @ApiPropertyOptional({
    example: '([HCT]*10)/[RBC]',
    description: 'Formula using [CODE] references — computed on frontend',
  })
  @IsOptional()
  @IsString()
  formula?: string;

  @ApiPropertyOptional({ type: ReferenceRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReferenceRangeDto)
  referenceRange?: ReferenceRangeDto;
}

export class ImportTemplateSectionDto {
  @ApiProperty({ example: 'Serie Roja' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0)
  sortOrder!: number;

  @ApiProperty({ type: [ImportTemplateAnalyteDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportTemplateAnalyteDto)
  analytes!: ImportTemplateAnalyteDto[];
}

export class ImportTemplateDto {
  @ApiProperty({
    example: 'CBC',
    description: 'Catalog item code to link this template to',
  })
  @IsString()
  @IsNotEmpty()
  catalogItemCode!: string;

  @ApiProperty({ enum: PatientSpeciesDto })
  @IsEnum(PatientSpeciesDto)
  species!: PatientSpeciesDto;

  @ApiPropertyOptional({
    example: 0,
    description: 'Inclusive lower age bound in weeks. Null = no lower limit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ageMinWeeks?: number;

  @ApiPropertyOptional({
    example: 4,
    description: 'Inclusive upper age bound in weeks. Null = no upper limit.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ageMaxWeeks?: number;

  @ApiProperty({ example: 'Hemograma Canino Adulto' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    example: 'Tipo de muestra: sangre entera anticoagulada con EDTA.',
  })
  @IsOptional()
  @IsString()
  defaultObservations?: string;

  @ApiProperty({ type: [ImportTemplateSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportTemplateSectionDto)
  sections!: ImportTemplateSectionDto[];
}

// ---------------------------------------------------------------------------
// POST /results/reports
// Create a structured result report from the matching template.
// ---------------------------------------------------------------------------

export class CreateReportDto {
  @ApiProperty({ example: 'clx...' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}

// ---------------------------------------------------------------------------
// PATCH /results/reports/:id/analytes
// Batch-save analyte values on a DRAFT report.
// ---------------------------------------------------------------------------

export class AnalyteValueDto {
  @ApiProperty({ example: 'clx...' })
  @IsString()
  @IsNotEmpty()
  analyteId!: string;

  @ApiPropertyOptional({ example: 10.5 })
  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @ApiPropertyOptional({ example: 'Escaso' })
  @IsOptional()
  @IsString()
  textValue?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean;

  @ApiPropertyOptional({ example: 'Amarillo' })
  @IsOptional()
  @IsString()
  selectValue?: string;
}

export class SaveAnalytesDto {
  @ApiProperty({ type: [AnalyteValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnalyteValueDto)
  analytes!: AnalyteValueDto[];
}

// ---------------------------------------------------------------------------
// POST /results/reports/:id/release
// Release the report — computes flags, freezes values, completes the case.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /results/reports/:id/interpret
// Get or create AI interpretation for a released report — clinic-facing.
// ---------------------------------------------------------------------------

export class AiInterpretationFlaggedAnalyteDto {
  @ApiProperty({ example: 'WBC' })
  code!: string;

  @ApiProperty({ example: 'Recuento total de leucocitos (WBC)' })
  name!: string;

  @ApiProperty({ example: '11.3 10^3/µL' })
  value!: string;

  @ApiProperty({ enum: ['H', 'L'] })
  flag!: 'H' | 'L';

  @ApiProperty({
    example: 'Mild leukocytosis may suggest an active inflammatory response.',
  })
  clinicalMeaning!: string;
}

export class AiInterpretationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  reportId!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  model!: string;

  @ApiProperty({ example: 'v1' })
  promptVersion!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: [AiInterpretationFlaggedAnalyteDto] })
  flaggedAnalytes!: AiInterpretationFlaggedAnalyteDto[];

  @ApiProperty({ type: [String] })
  risks!: string[];

  @ApiProperty({ type: [String] })
  suggestedNextSteps!: string[];

  @ApiProperty()
  disclaimer!: string;

  @ApiPropertyOptional()
  generatedByUserId?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

// ---------------------------------------------------------------------------

export class ReleaseReportDto {
  @ApiPropertyOptional({
    example: 'Tipo de muestra: sangre entera anticoagulada con EDTA.',
  })
  @IsOptional()
  @IsString()
  observations?: string;

  @ApiPropertyOptional({ example: 'Karina Martinez' })
  @IsOptional()
  @IsString()
  processedByName?: string;

  @ApiPropertyOptional({ example: 'Analista de Laboratorio' })
  @IsOptional()
  @IsString()
  processedByRole?: string;

  @ApiPropertyOptional({
    example: 'Microbióloga\nUniversidad del Valle',
  })
  @IsOptional()
  @IsString()
  processedByCredentials?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  approvedByName?: string;

  @ApiPropertyOptional({ example: 'Jefe de Laboratorio y Calidad' })
  @IsOptional()
  @IsString()
  approvedByRole?: string;

  @ApiPropertyOptional({
    example: 'Bacteriólogo y Laboratorista Clínico\nUniversidad del Valle',
  })
  @IsOptional()
  @IsString()
  approvedByCredentials?: string;

  @ApiPropertyOptional({
    example: 'https://storage.example.com/signatures/Martinez.png',
  })
  @IsOptional()
  @IsUrl()
  signatureUrl?: string;
}
