import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** POST lab/specimens/:specimenId/receive — one awaited (or missing) tube arrives. */
export class ReceiveSpecimenDto {
  @IsBoolean()
  accepted!: boolean;

  /** Defaults to the number the tube was given when it was requested */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  accessionNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
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

/** POST lab/ordered-tests/:testId/request-sample — ask the clinic for another tube. */
export class RequestSampleDto {
  /** Needed only when the test has no configured specimen requirement */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  specimenType?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  containerType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
