import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportPickupProblemDto {
  @IsEnum([
    'CLINIC_CLOSED',
    'SAMPLE_NOT_READY',
    'INCORRECT_ADDRESS',
    'UNABLE_TO_CONTACT',
    'OTHER',
  ])
  reason!: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  details?: string;
}
