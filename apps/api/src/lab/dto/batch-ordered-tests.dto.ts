import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class BatchClaimItem {
  @IsString()
  testId!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class BatchClaimDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchClaimItem)
  tests!: BatchClaimItem[];
}

export class BatchStartDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  testIds!: string[];
}

export class BatchResultSessionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  testIds!: string[];
}

/** One analyte value, same shape as single-test entry. */
class BatchAnalyteValue {
  @IsString()
  templateAnalyteId!: string;

  @IsNumber()
  @IsOptional()
  numericValue?: number | null;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  textValue?: string | null;

  @IsBoolean()
  @IsOptional()
  booleanValue?: boolean | null;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  selectValue?: string | null;
}

class BatchSaveItem {
  @IsString()
  testId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchAnalyteValue)
  analytes!: BatchAnalyteValue[];

  @IsString()
  @MaxLength(10000)
  @IsOptional()
  observations?: string | null;
}

const UniqueTestIds = () =>
  ValidateBy({
    name: 'uniqueTestIds',
    validator: {
      validate: (tests: unknown) =>
        Array.isArray(tests) &&
        new Set(
          tests.map((t) => (t as Record<string, unknown> | null)?.['testId'])
        ).size === tests.length,
      defaultMessage: () => 'each test can appear only once in a batch',
    },
  });

/** POST lab/ordered-tests/batch-save-submit — tests of one order. */
export class BatchSaveSubmitDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @UniqueTestIds()
  @ValidateNested({ each: true })
  @Type(() => BatchSaveItem)
  tests!: BatchSaveItem[];

  @IsBoolean()
  submitAfterSave!: boolean;
}
