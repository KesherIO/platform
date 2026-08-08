import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

const PICKUP_STATUSES = [
  'REQUESTED',
  'ASSIGNED',
  'NOTIFIED',
  'ACCEPTED',
  'COLLECTED',
  'IN_TRANSIT',
  'RECEIVED_AT_LAB',
  'CANCELLED',
  'FAILED',
];

export class ListPickupsDto {
  /** Comma-separated PickupStatus values, e.g. "ASSIGNED,NOTIFIED,ACCEPTED" —
   * lets the Collections page filter tabs group several statuses at once. */
  @Matches(
    new RegExp(
      `^(${PICKUP_STATUSES.join('|')})(,(${PICKUP_STATUSES.join('|')}))*$`
    )
  )
  @IsOptional()
  status?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  messengerId?: string;

  /** Inclusive lower bound on Pickup.createdAt, e.g. "2026-08-01". */
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  /** Inclusive upper bound on Pickup.createdAt (end of day), e.g. "2026-08-08". */
  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize?: number;
}
