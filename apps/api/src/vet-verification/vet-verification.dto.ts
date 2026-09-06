import { IsNotEmpty, IsString } from 'class-validator';

export class RejectVerificationDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;
}

export class RevokeVerificationDto {
  @IsString()
  @IsNotEmpty()
  revokedReason!: string;
}
