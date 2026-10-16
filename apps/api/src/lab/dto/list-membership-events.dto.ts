import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListMembershipEventsDto {
  /** Filter to one person — works for removed members too. */
  @IsOptional()
  @IsString()
  userId?: string;

  /** id of the last event of the previous page */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
