import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Min,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgeUnit, PatientSpecies, PatientSex } from '@vet-ai/shared-types';

// ---------------------------------------------------------------------------
// POST /cases
// ---------------------------------------------------------------------------

export class CreateCaseDto {
  @ApiProperty({ example: 'Luna' })
  @IsString()
  @IsNotEmpty()
  patientName!: string;

  @ApiProperty({ enum: PatientSpecies })
  @IsEnum(PatientSpecies)
  patientSpecies!: PatientSpecies;

  @ApiPropertyOptional({ enum: PatientSex })
  @IsOptional()
  @IsEnum(PatientSex)
  patientSex?: PatientSex;

  @ApiPropertyOptional({ example: 'Labrador Retriever' })
  @IsOptional()
  @IsString()
  patientBreed?: string;

  @ApiPropertyOptional({
    example: '2022-03-15',
    description: 'ISO date — use when exact DOB is known',
  })
  @IsOptional()
  @IsDateString()
  patientDateOfBirth?: string;

  /**
   * Must be provided together with patientAgeUnit.
   * Both must be set or both must be absent.
   */
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  patientAge?: number;

  @ApiPropertyOptional({ enum: AgeUnit })
  @IsOptional()
  @IsEnum(AgeUnit)
  patientAgeUnit?: AgeUnit;

  @ApiPropertyOptional({ example: 28.5, description: 'Weight in kilograms' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  patientWeight?: number;

  @ApiProperty({ example: 'Carlos Mendoza' })
  @IsString()
  @IsNotEmpty()
  ownerName!: string;

  @ApiPropertyOptional({ example: '+1 512 555 0199' })
  @IsOptional()
  @IsString()
  ownerPhone?: string;
}

// ---------------------------------------------------------------------------
// PATCH /cases/:id/patient
// Allowed in: OPEN, TRIAGED
// All fields are optional — only provided fields are updated.
// Age/ageUnit pair constraint still applies when either field is present.
// ---------------------------------------------------------------------------

export class UpdatePatientInfoDto {
  @ApiPropertyOptional({ example: 'Luna' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  patientName?: string;

  @ApiPropertyOptional({ enum: PatientSpecies })
  @IsOptional()
  @IsEnum(PatientSpecies)
  patientSpecies?: PatientSpecies;

  @ApiPropertyOptional({ enum: PatientSex })
  @IsOptional()
  @IsEnum(PatientSex)
  patientSex?: PatientSex;

  @ApiPropertyOptional({ example: 'Labrador Retriever' })
  @IsOptional()
  @IsString()
  patientBreed?: string;

  @ApiPropertyOptional({
    example: '2022-03-15',
    description: 'ISO date — use when exact DOB is known',
  })
  @IsOptional()
  @IsDateString()
  patientDateOfBirth?: string;

  /**
   * If patientAge is provided, patientAgeUnit must also be provided, and vice versa.
   * To clear the age, send both as null — not supported in MVP (omit instead).
   */
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  patientAge?: number;

  @ApiPropertyOptional({ enum: AgeUnit })
  @IsOptional()
  @IsEnum(AgeUnit)
  patientAgeUnit?: AgeUnit;

  @ApiPropertyOptional({ example: 28.5, description: 'Weight in kilograms' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  patientWeight?: number;

  @ApiPropertyOptional({ example: 'Carlos Mendoza' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ownerName?: string;

  @ApiPropertyOptional({ example: '+1 512 555 0199' })
  @IsOptional()
  @IsString()
  ownerPhone?: string;
}

// ---------------------------------------------------------------------------
// PATCH /cases/:id/symptoms
// Allowed in: OPEN
// ---------------------------------------------------------------------------

export class AddSymptomsDto {
  @ApiProperty({
    example: 'Vomiting for 2 days, loss of appetite, mild lethargy',
    description: 'Free-text symptom description entered by the vet',
  })
  @IsString()
  @MinLength(1)
  symptoms!: string;
}

// ---------------------------------------------------------------------------
// PATCH /cases/:id/catalog-selection
// Allowed in: OPEN, TRIAGED
// Replaces the entire selected catalog item list.
// ---------------------------------------------------------------------------

export class SelectCatalogItemsDto {
  @ApiProperty({
    example: ['clItemId1', 'clItemId2'],
    description:
      'Array of catalog item IDs selected by the vet. Replaces any previous selection.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  selectedCatalogItemIds!: string[];
}

// ---------------------------------------------------------------------------
// POST /cases/:id/order
// Allowed in: OPEN, TRIAGED
// Requires: selectedCatalogItems already set (enforced in service, not DTO)
// orderSentAt is set by the server — not accepted from the client.
// ---------------------------------------------------------------------------

export class SendOrderDto {
  @ApiPropertyOptional({
    example: 'Please rush the parvovirus panel — patient is critical.',
    description: 'Optional free-text notes included with the lab order',
  })
  @IsOptional()
  @IsString()
  orderNotes?: string;
}

// ---------------------------------------------------------------------------
// POST /cases/:id/complete
// Allowed in: ORDERED
// Results are entered via the ResultReport flow — no resultsUrl check here.
// No client payload — status transition only.
// ---------------------------------------------------------------------------

export class CompleteCaseDto {}

// ---------------------------------------------------------------------------
// POST /cases/:id/cancel
// Allowed in: OPEN, TRIAGED, ORDERED
// No client payload — status transition only.
// ---------------------------------------------------------------------------

export class CancelCaseDto {}
