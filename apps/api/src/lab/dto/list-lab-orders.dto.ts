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

export class ListLabOrdersDto {
  @IsEnum([
    'PENDING',
    'READY_FOR_PICKUP',
    'COLLECTED',
    'RECEIVED_BY_LAB',
    'PROCESSING',
    'COMPLETED',
    'CANCELLED',
  ])
  @IsOptional()
  status?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number;
}
