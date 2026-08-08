import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const ORDER_STATUSES = [
  'PENDING',
  'READY_FOR_PICKUP',
  'COLLECTED',
  'RECEIVED_BY_LAB',
  'PROCESSING',
  'COMPLETED',
  'CANCELLED',
];

export class ListLabOrdersDto {
  /** Comma-separated OrderStatus values, e.g. "PENDING,READY_FOR_PICKUP" —
   * lets queue filter tabs group several statuses at once. */
  @Matches(
    new RegExp(
      `^(${ORDER_STATUSES.join('|')})(,(${ORDER_STATUSES.join('|')}))*$`
    )
  )
  @IsOptional()
  status?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  /** Inclusive lower bound on Order.createdAt, e.g. "2026-08-01". */
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  /** Inclusive upper bound on Order.createdAt (end of day), e.g. "2026-08-08". */
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
