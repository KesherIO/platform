import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Same filters as ListClientsDto, without paging (plan B9). */
export class ExportClientsDto {
  @IsEnum(['PENDING', 'ACTIVE', 'SUSPENDED'])
  @IsOptional()
  status?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  /** Query strings arrive as text: only "true" turns notes on. */
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  includeNotes?: boolean;
}
