import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class LabSignerDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  roles!: string[];

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  specialty?: string;

  @IsString()
  @IsOptional()
  university?: string;

  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @IsString()
  @IsOptional()
  signatureUrl?: string;
}

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LabSignerDto)
  @IsOptional()
  signers?: LabSignerDto[];
}
