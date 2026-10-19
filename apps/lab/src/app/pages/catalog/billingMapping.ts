import type { ParsedSheet } from '../../types/lab.types';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const CODE_HEADERS = ['item', 'codigo', 'code', 'cod'];
const DESCRIPTION_HEADERS = [
  'descripcion',
  'description',
  'nombre',
  'name',
  'servicio',
];

export interface MappingFileRow {
  /** 1-based row number in the file */
  rowNumber: number;
  code: string;
  description: string;
}

/**
 * Reads the lab's billing list (Item / Descripción) from a parsed sheet.
 * Columns are found by header name, accents and case ignored. Returns null
 * when either column is missing — nothing is guessed by position.
 */
export function readMappingRows(sheet: ParsedSheet): MappingFileRow[] | null {
  const headers = sheet.headers.map(fold);
  const codeCol = headers.findIndex((h) => CODE_HEADERS.includes(h));
  const descCol = headers.findIndex((h) => DESCRIPTION_HEADERS.includes(h));
  if (codeCol === -1 || descCol === -1) return null;
  return sheet.rows
    .map((cells, i) => ({
      rowNumber: sheet.rowNumbers[i],
      code: (cells[codeCol]?.text ?? '').trim(),
      description: (cells[descCol]?.text ?? '').trim(),
    }))
    .filter((r) => r.code !== '' || r.description !== '');
}

/** The JSON body of an ApiError (the API's { code, message, ... }), else null. */
export function errorBody(err: unknown): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse((err as Error).message);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
