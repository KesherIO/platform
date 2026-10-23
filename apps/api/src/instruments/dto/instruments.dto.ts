import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCredentialDto {
  @ApiProperty({ description: 'The analyzer this connector will upload for' })
  @IsString()
  @IsNotEmpty()
  analyzerId!: string;

  @ApiProperty({ example: 'Lab PC – VH-30' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class CreateSampleLinkDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  analyzerId!: string;

  @ApiProperty({
    description: "The analyzer's own sample ID (PID-3). NOT an order number.",
    example: '168',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  sampleId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiPropertyOptional({ description: 'Default: now' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @ApiPropertyOptional({ description: 'Default: 24 h after validFrom' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;
}

export class ResolveSampleDto {
  @ApiProperty({ description: 'The order this analyzer sample belongs to' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;
}

export class ApproveDto {
  @ApiProperty({
    example: ['CONTENT_CHANGED'],
    description: 'Reason codes being accepted',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(
    [
      'CONTENT_CHANGED',
      'EXPIRED_REAGENT',
      'EXISTING_MANUAL_VALUES',
      'DRAFT_MODIFIED_SINCE_IMPORT',
      'ANALYZER_RERUN',
      'ORDER_NUMBER_LINK_CONFLICT',
    ],
    { each: true }
  )
  reasons!: string[];

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class DismissDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class UpsertMappingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  analyzerId!: string;

  @ApiProperty({
    example: 'HGB',
    description: 'As sent by the analyzer (OBX-3)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  parameterCode!: string;

  @ApiProperty({
    example: 'g/dL',
    description: 'Exact unit string the analyzer sends',
  })
  @IsString()
  @MaxLength(40)
  analyzerUnit!: string;

  @ApiProperty({
    example: 'CBC',
    description: 'Catalog code of the ordered test',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  catalogItemCode!: string;

  @ApiProperty({ example: 'HGB', description: 'ResultTemplateAnalyte.code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  analyteCode!: string;

  @ApiPropertyOptional({
    example: 0.1,
    description: 'analyte value = analyzer value × multiplier',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  multiplier?: number;
}
