import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const ORDERED_TEST_STATUSES = [
  'PENDING',
  'READY',
  'IN_PROGRESS',
  'RESULTS_ENTERED',
  'IN_REVIEW',
  'COMPLETED',
  'BLOCKED',
  'CANCELLED',
];

const DEPARTMENTS = [
  'HEMATOLOGY',
  'CHEMISTRY',
  'URINALYSIS',
  'PARASITOLOGY',
  'SEROLOGY',
  'ENDOCRINOLOGY',
  'MICROBIOLOGY',
  'OTHER',
];

export class ListWorklistDto {
  @IsIn([...DEPARTMENTS, '__none__'])
  @IsOptional()
  department?: string;

  @Matches(
    new RegExp(
      `^(${ORDERED_TEST_STATUSES.join('|')})(,(${ORDERED_TEST_STATUSES.join(
        '|'
      )}))*$`
    )
  )
  @IsOptional()
  status?: string;

  @IsIn(['unassigned', 'mine', 'all'])
  @IsOptional()
  assignmentFilter?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

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
