import { IsString, IsOptional, IsArray, ArrayNotEmpty } from 'class-validator';

export class ApproveReleaseDto {
  @IsString()
  signerId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  testIds: string[];

  @IsString()
  @IsOptional()
  reviewNotes?: string;

  @IsString()
  @IsOptional()
  observations?: string;
}

export class SubmitForReviewDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  testIds?: string[];
}

export class RequestCorrectionsDto {
  @IsString()
  correctionNotes: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  testIds?: string[];
}
