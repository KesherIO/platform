import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateBy,
} from 'class-validator';
import { ClientFieldsDto } from './create-client.dto';

/** Server-side cap; the lab app sends groups of 25 (plan A5). */
export const IMPORT_MAX_ROWS_PER_REQUEST = 50;

function hasUniqueRowNumbers(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  const numbers = rows.map((row) =>
    row !== null && typeof row === 'object'
      ? (row as Record<string, unknown>)['rowNumber']
      : undefined
  );
  return (
    numbers.every((n) => Number.isInteger(n) && (n as number) >= 1) &&
    new Set(numbers).size === numbers.length
  );
}

const HasUniqueRowNumbers = () =>
  ValidateBy({
    name: 'hasUniqueRowNumbers',
    validator: {
      validate: hasUniqueRowNumbers,
      defaultMessage: () =>
        'every row needs a rowNumber: an integer >= 1, unique within the request',
    },
  });

/**
 * POST /lab/clients/import — validates the request's structure only. Each row
 * is validated on its own in the service (ImportClientRowDto), so one bad row
 * comes back as `invalid` instead of rejecting the whole request (plan A3).
 */
export class ImportClientsDto {
  /** Created by the browser when the import starts; reused on retries */
  @IsUUID()
  importBatchId!: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_ROWS_PER_REQUEST)
  @IsObject({ each: true })
  @HasUniqueRowNumbers()
  rows!: Record<string, unknown>[];
}

/** One import row — validated per row by the service, not by the global pipe. */
export class ImportClientRowDto extends ClientFieldsDto {
  /** Row number in the user's file, used to report results back */
  @IsInt()
  @Min(1)
  rowNumber!: number;
}
