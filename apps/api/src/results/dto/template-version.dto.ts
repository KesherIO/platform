import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyteValueTypeDto, PatientSpeciesDto } from './results.dto';

export class TemplateAnalyteDto {
  @ApiProperty({ example: 'WBC' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ example: 'Recuento total de leucocitos' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  technique?: string;

  @ApiProperty({ enum: AnalyteValueTypeDto })
  @IsEnum(AnalyteValueTypeDto)
  valueType!: AnalyteValueTypeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHeader?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formula?: string;

  @ApiPropertyOptional()
  @IsOptional()
  referenceRange?: { min?: number; max?: number; displayText: string };
}

export class TemplateSectionDto {
  @ApiProperty({ example: 'Serie Roja' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiProperty({ type: [TemplateAnalyteDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateAnalyteDto)
  analytes!: TemplateAnalyteDto[];
}

export class CreateTemplateDefinitionDto {
  @ApiProperty({ example: 'CBC' })
  @IsString()
  @IsNotEmpty()
  catalogItemCode!: string;

  @ApiProperty({ enum: PatientSpeciesDto })
  @IsEnum(PatientSpeciesDto)
  species!: PatientSpeciesDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  ageMinWeeks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  ageMaxWeeks?: number;

  @ApiProperty({ example: 'Hemograma Completo Canino' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultObservations?: string;

  @ApiProperty({ type: [TemplateSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  sections!: TemplateSectionDto[];
}

export class UpdateDraftVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultObservations?: string;

  @ApiPropertyOptional({ type: [TemplateSectionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  sections?: TemplateSectionDto[];
}
