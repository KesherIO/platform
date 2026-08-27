import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  Matches,
  MaxLength,
  ArrayMaxSize,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyteValueTypeDto, PatientSpeciesDto } from './results.dto';

export class ObservationPhraseDto {
  @ApiProperty({ example: 'REPETIR_EXAMEN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  code!: string;

  @ApiProperty({ example: 'Repetir examen' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @ApiProperty({
    example: 'Se recomienda repetir el examen con una nueva muestra.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;

  @ApiPropertyOptional({ example: 'EXAMEN_MICROSCOPICO' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sectionCode?: string;
}

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
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
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
  @ApiPropertyOptional({ example: 'EXAMEN_MACROSCOPICO' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  code?: string;

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
  @MaxLength(2000)
  defaultObservations?: string;

  @ApiProperty({ type: [TemplateSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  sections!: TemplateSectionDto[];

  @ApiPropertyOptional({ type: [ObservationPhraseDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ObservationPhraseDto)
  observationPhrases?: ObservationPhraseDto[];
}

export class UpdateDraftVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  defaultObservations?: string;

  @ApiPropertyOptional({ type: [TemplateSectionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSectionDto)
  sections?: TemplateSectionDto[];

  @ApiPropertyOptional({ type: [ObservationPhraseDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ObservationPhraseDto)
  observationPhrases?: ObservationPhraseDto[];
}
