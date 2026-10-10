import Papa from 'papaparse';
import type { ParsedSheet, SheetCell } from '../types/lab.types';

/**
 * CSV / XLSX → header + text cells (docs/CLIENT_BULK_IMPORT_PLAN.md A6).
 * Values are never turned into numbers and digits are never added or
 * guessed: every cell keeps the text that was in the file, plus how the
 * spreadsheet stored it so the preview can warn about lost leading zeros.
 */

export const MAX_IMPORT_ROWS = 500;

export type SpreadsheetError =
  | 'UNSUPPORTED_FILE'
  | 'EMPTY_FILE'
  | 'NO_DATA_ROWS'
  | 'TOO_MANY_ROWS'
  | 'UNREADABLE_FILE';

export class SpreadsheetParseError extends Error {
  constructor(readonly code: SpreadsheetError) {
    super(code);
  }
}

const text = (value: string): SheetCell => ({ text: value, source: 'text' });

/** Drops fully empty rows and columns, splits off the header row. */
function toSheet(grid: SheetCell[][]): ParsedSheet {
  const isEmpty = (c: SheetCell | undefined) => !c || c.text.trim() === '';
  const numbered = grid
    .map((cells, i) => ({ cells, rowNumber: i + 1 }))
    .filter((r) => r.cells.some((c) => !isEmpty(c)));
  if (numbered.length === 0) throw new SpreadsheetParseError('EMPTY_FILE');

  const [header, ...data] = numbered;
  const width = Math.max(...numbered.map((r) => r.cells.length));
  const keep = Array.from({ length: width }, (_, col) =>
    numbered.some((r) => !isEmpty(r.cells[col]))
  );
  const columns = keep.flatMap((k, col) => (k ? [col] : []));

  if (data.length === 0) throw new SpreadsheetParseError('NO_DATA_ROWS');
  if (data.length > MAX_IMPORT_ROWS) {
    throw new SpreadsheetParseError('TOO_MANY_ROWS');
  }

  return {
    headers: columns.map((col) => header.cells[col]?.text.trim() ?? ''),
    rows: data.map((r) => columns.map((col) => r.cells[col] ?? text(''))),
    rowNumbers: data.map((r) => r.rowNumber),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Decodes CSV bytes: UTF-8 (BOM removed), or Windows-1252 when the bytes
 * aren't valid UTF-8 — what Excel on Windows saves as "CSV" in Spanish.
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    decoded = new TextDecoder('windows-1252').decode(bytes);
  }
  return decoded.replace(/^\uFEFF/, '');
}

/**
 * Separator used in the header line: ",", ";" (Excel in Spanish/Portuguese
 * locales) or tab — whichever appears most outside quotes. Papaparse's own
 * guess can be thrown off by quoted multi-line fields further down.
 */
export function detectDelimiter(csv: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of csv) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).reduce((best, entry) =>
    entry[1] > best[1] ? entry : best
  )[0];
}

export function parseCsvText(csv: string): ParsedSheet {
  const content = csv.replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(content, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
    delimiter: detectDelimiter(content),
  });
  return toSheet(result.data.map((row) => row.map(text)));
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Excel keeps 15 significant digits; anything longer may be rounded. */
function numberCell(value: number, numFmt: string | undefined): SheetCell {
  const isInt = Number.isInteger(value);
  const digits = isInt
    ? String(Math.abs(value)).replace(/^0+/, '').length
    : String(value)
        .replace(/[^0-9]/g, '')
        .replace(/^0+/, '').length;
  if (digits > 15 || (isInt && !Number.isSafeInteger(value))) {
    return { text: String(value), source: 'unsafe_number' };
  }

  // A format like "0000000000" pads the number on screen and in the file, so
  // padding reproduces what the user saw instead of guessing.
  const padding = numFmt?.match(/^0+$/)?.[0].length;
  if (isInt && value >= 0 && padding && padding > String(value).length) {
    return {
      text: String(value).padStart(padding, '0'),
      source: 'padded_number',
    };
  }
  return { text: String(value), source: 'number' };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Converts one exceljs cell value (any type) to a SheetCell. */
export function xlsxCell(value: unknown, numFmt?: string): SheetCell {
  if (value === null || value === undefined) return text('');
  if (typeof value === 'number') return numberCell(value, numFmt);
  if (typeof value === 'string') return text(value);
  if (typeof value === 'boolean') return text(value ? 'TRUE' : 'FALSE');
  if (value instanceof Date) {
    return text(
      `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(
        value.getUTCDate()
      )}`
    );
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // Formula: use the cached result, same rules as a plain value.
    if ('formula' in v || 'sharedFormula' in v) {
      return xlsxCell(v['result'], numFmt);
    }
    // Rich text: the plain text of every run.
    if (Array.isArray(v['richText'])) {
      return text(
        (v['richText'] as { text?: string }[]).map((r) => r.text ?? '').join('')
      );
    }
    // Hyperlink: the visible text.
    if ('text' in v) return xlsxCell(v['text'], numFmt);
    if ('error' in v) return text('');
  }
  return text(String(value));
}

/** First worksheet of an .xlsx file. exceljs is loaded only when needed. */
export async function parseXlsxBuffer(
  buffer: ArrayBuffer
): Promise<ParsedSheet> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new SpreadsheetParseError('UNREADABLE_FILE');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SpreadsheetParseError('EMPTY_FILE');

  const grid: SheetCell[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: SheetCell[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, sheet.columnCount); c++) {
      const cell = row.getCell(c);
      cells.push(xlsxCell(cell.value, cell.numFmt));
    }
    grid.push(cells);
  }
  return toSheet(grid);
}

// ---------------------------------------------------------------------------

export async function readSpreadsheet(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    return parseCsvText(decodeCsv(await file.arrayBuffer()));
  }
  if (name.endsWith('.xlsx')) {
    return parseXlsxBuffer(await file.arrayBuffer());
  }
  throw new SpreadsheetParseError('UNSUPPORTED_FILE');
}

/** "1.09874E+09" — digits were lost when the file was saved from Excel. */
export function looksLikeScientificNotation(value: string): boolean {
  return /^[+-]?\d+(?:[.,]\d+)?E[+-]?\d+$/i.test(value.trim());
}
