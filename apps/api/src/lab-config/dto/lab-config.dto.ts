import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DepartmentDto {
  HEMATOLOGY = 'HEMATOLOGY',
  CHEMISTRY = 'CHEMISTRY',
  URINALYSIS = 'URINALYSIS',
  PARASITOLOGY = 'PARASITOLOGY',
  SEROLOGY = 'SEROLOGY',
  ENDOCRINOLOGY = 'ENDOCRINOLOGY',
  MICROBIOLOGY = 'MICROBIOLOGY',
  OTHER = 'OTHER',
}

export enum ProcessingMethodDto {
  MANUAL = 'MANUAL',
  ANALYZER = 'ANALYZER',
}

// ---------------------------------------------------------------------------
// Analyzer DTOs
// ---------------------------------------------------------------------------

export class CreateAnalyzerDto {
  @ApiProperty({ example: 'BioSystems A25' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'A25' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 'BioSystems' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiProperty({ enum: DepartmentDto })
  @IsEnum(DepartmentDto)
  department!: DepartmentDto;
}

export class UpdateAnalyzerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ enum: DepartmentDto })
  @IsOptional()
  @IsEnum(DepartmentDto)
  department?: DepartmentDto;
}

// ---------------------------------------------------------------------------
// Specimen Requirement DTOs
// ---------------------------------------------------------------------------

export class SpecimenRequirementDto {
  @ApiProperty({ example: 'EDTA_BLOOD' })
  @IsString()
  @IsNotEmpty()
  specimenType!: string;

  @ApiProperty({ example: 'EDTA_TUBE' })
  @IsString()
  @IsNotEmpty()
  containerType!: string;

  @ApiPropertyOptional({ example: 2.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumVolumeMl?: number;

  @ApiProperty({ example: 'PRIMARY' })
  @IsString()
  @IsNotEmpty()
  requirementGroupKey!: string;

  @ApiPropertyOptional({ example: 'PATIENT' })
  @IsOptional()
  @IsString()
  specimenRole?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAlternativeWithinGroup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Lab Test Configuration DTOs
// ---------------------------------------------------------------------------

export class UpsertLabTestConfigDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  catalogItemId!: string;

  @ApiProperty({ enum: DepartmentDto })
  @IsEnum(DepartmentDto)
  department!: DepartmentDto;

  @ApiPropertyOptional({ enum: ProcessingMethodDto })
  @IsOptional()
  @IsEnum(ProcessingMethodDto)
  defaultProcessingMethod?: ProcessingMethodDto;

  @ApiPropertyOptional({ type: [String], enum: ProcessingMethodDto })
  @IsOptional()
  @IsArray()
  @IsEnum(ProcessingMethodDto, { each: true })
  allowedProcessingMethods?: ProcessingMethodDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultAnalyzerId?: string;

  @ApiPropertyOptional({ type: [SpecimenRequirementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecimenRequirementDto)
  specimenRequirements?: SpecimenRequirementDto[];
}
