import { IsOptional, IsString } from 'class-validator';

export class UpsertLaboratoryProfileDto {
  @IsString()
  @IsOptional()
  accreditationNumber?: string;

  @IsString()
  @IsOptional()
  directorName?: string;

  @IsString()
  @IsOptional()
  directorCredentials?: string;

  @IsString()
  @IsOptional()
  signatureUrl?: string;

  @IsString()
  @IsOptional()
  defaultObservations?: string;
}
