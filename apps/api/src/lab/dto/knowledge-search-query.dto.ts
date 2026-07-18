import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PatientSpecies } from '@prisma/client';

export class KnowledgeSearchQueryDto {
  @IsEnum(PatientSpecies)
  species!: PatientSpecies;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  symptoms?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  topK?: number;
}
