import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

class AmendmentAnalyteInput {
  @IsString()
  id: string;

  @IsNumber()
  @IsOptional()
  numericValue?: number | null;

  @IsString()
  @IsOptional()
  textValue?: string | null;

  @IsBoolean()
  @IsOptional()
  booleanValue?: boolean | null;

  @IsString()
  @IsOptional()
  selectValue?: string | null;
}

export class InitiateAmendmentDto {
  @IsString()
  reportTestId: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason: string;
}

export class EditAmendmentAnalytesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmendmentAnalyteInput)
  analytes: AmendmentAnalyteInput[];
}

export class ApproveAmendmentDto {
  @IsString()
  signerId: string;

  @IsString()
  @IsOptional()
  reviewNotes?: string;

  @IsString()
  @IsOptional()
  observations?: string;
}
