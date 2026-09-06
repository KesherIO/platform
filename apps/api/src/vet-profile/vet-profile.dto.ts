import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateVetProfileDto {
  @IsString()
  @IsNotEmpty()
  legalName!: string;
}

export class UpdateVetProfileDto {
  @IsString()
  @IsNotEmpty()
  legalName!: string;
}

export class CreateCredentialBodyDto {
  @IsString()
  @IsNotEmpty()
  licenseNumber!: string;

  @IsString()
  @IsNotEmpty()
  issuingCountry!: string;

  @IsString()
  @IsOptional()
  issuingAuthority?: string;

  @IsDateString()
  @IsOptional()
  licenseExpiresAt?: string;
}
