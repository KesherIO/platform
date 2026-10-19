import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BILLING_CODE_MAX_LENGTH } from '../billing-code.util';

const DAY_MESSAGE = 'must be a day as YYYY-MM-DD';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true;

/** Inclusive order-date range, in the lab's timezone. */
export class BillingRangeDto {
  @Matches(DAY_PATTERN, { message: `dateFrom ${DAY_MESSAGE}` })
  dateFrom!: string;

  @Matches(DAY_PATTERN, { message: `dateTo ${DAY_MESSAGE}` })
  dateTo!: string;
}

export class CreateBillingExportDto extends BillingRangeDto {
  /** Leave out lines that an earlier export already contained. Off by default. */
  @IsOptional()
  @IsBoolean()
  onlyNew?: boolean;
}

export class PreviewBillingExportDto extends BillingRangeDto {
  /** Query strings arrive as text: only "true" turns it on. */
  @Transform(toBool)
  @IsBoolean()
  @IsOptional()
  onlyNew?: boolean;
}

export class MappingRowDto {
  @IsString()
  @MaxLength(200)
  code!: string;

  @IsString()
  @MaxLength(500)
  description!: string;
}

export class SuggestMappingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MappingRowDto)
  rows!: MappingRowDto[];
}

export class MappingAssignmentDto {
  @IsString()
  @IsNotEmpty()
  catalogItemId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(BILLING_CODE_MAX_LENGTH)
  billingCode!: string;
}

export class ApplyMappingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MappingAssignmentDto)
  assignments!: MappingAssignmentDto[];

  /**
   * Allow replacing a billing code an item already has. Off by default: the
   * request fails and lists the items instead.
   */
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}

export class AssignDeletedItemCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(BILLING_CODE_MAX_LENGTH)
  billingCode!: string;
}
