import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const RESULTS_VIEWS = ['released', 'in_progress'] as const;
export type ResultsView = (typeof RESULTS_VIEWS)[number];

/** GET lab/results/search — the Resultados page filters. */
export class SearchResultsDto {
  /** released (default): current released versions; in_progress: open tests, status only */
  @IsIn(RESULTS_VIEWS)
  @IsOptional()
  view?: ResultsView;

  /** Ordering clinic ("entidad") */
  @IsString()
  @MaxLength(50)
  @IsOptional()
  clinicId?: string;

  /** Inclusive, "YYYY-MM-DD" — release date (released) or order date (in progress) */
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  /** Patient, owner or requisition number, contains, case-insensitive */
  @IsString()
  @MaxLength(100)
  @IsOptional()
  patient?: string;

  /** Released view only: tests that contain this analyte code */
  @IsString()
  @MaxLength(50)
  @IsOptional()
  analyteCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  pageSize?: number;
}

/** GET lab/results/analytes?search= — analyte picker */
export class SearchAnalytesDto {
  @IsString()
  @MaxLength(50)
  @IsOptional()
  search?: string;
}
