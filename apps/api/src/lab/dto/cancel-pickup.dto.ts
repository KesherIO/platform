import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelPickupDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
