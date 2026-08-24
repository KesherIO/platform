import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AccessionSpecimenDto {
  @IsString()
  @IsNotEmpty()
  specimenType!: string;

  @IsString()
  @IsNotEmpty()
  containerType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  tubeIndex?: number;

  @IsOptional()
  @IsString()
  accessionNumber?: string;

  @IsBoolean()
  accepted!: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isHemolyzed?: boolean;

  @IsOptional()
  @IsBoolean()
  isLipemic?: boolean;

  @IsOptional()
  @IsBoolean()
  isIcteric?: boolean;

  @IsOptional()
  @IsBoolean()
  isInsufficient?: boolean;

  @IsOptional()
  @IsBoolean()
  isContaminated?: boolean;

  @IsOptional()
  @IsBoolean()
  isWrongContainer?: boolean;

  @IsOptional()
  @IsBoolean()
  isLeaking?: boolean;
}

export class AccessionOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessionSpecimenDto)
  specimens!: AccessionSpecimenDto[];
}
