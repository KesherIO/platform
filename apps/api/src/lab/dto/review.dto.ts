import { IsString, IsOptional, IsArray } from 'class-validator';

export class ApproveReleaseDto {
  @IsString()
  signerId: string;

  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

export class RequestCorrectionsDto {
  @IsString()
  correctionNotes: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  testIds?: string[];
}
