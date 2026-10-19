import { errorBody, readMappingRows } from './billingMapping';
import type { ParsedSheet } from '../../types/lab.types';

const sheet = (headers: string[], rows: string[][]): ParsedSheet => ({
  headers,
  rows: rows.map((r) => r.map((text) => ({ text, source: 'text' as const }))),
  rowNumbers: rows.map((_, i) => i + 2),
});

describe('readMappingRows', () => {
  it('finds Item / Descripción by header, ignoring case and accents', () => {
    const rows = readMappingRows(
      sheet(['Item', 'Descripción'], [
        ['ALT', 'ALT Transaminasas T.G.P.'],
        ['SDMA022720261534', 'SDMA'],
      ])
    );
    expect(rows).toEqual([
      { rowNumber: 2, code: 'ALT', description: 'ALT Transaminasas T.G.P.' },
      { rowNumber: 3, code: 'SDMA022720261534', description: 'SDMA' },
    ]);
  });

  it('keeps leading zeros and trims spaces', () => {
    const rows = readMappingRows(
      sheet(['ITEM', 'DESCRIPCION'], [[' 00123 ', ' Albumina ']])
    );
    expect(rows?.[0]).toMatchObject({ code: '00123', description: 'Albumina' });
  });

  it('returns null instead of guessing when a column is missing', () => {
    expect(readMappingRows(sheet(['A', 'B'], [['1', '2']]))).toBeNull();
    expect(readMappingRows(sheet(['Item'], [['1']]))).toBeNull();
  });

  it('drops rows that are empty in both columns', () => {
    const rows = readMappingRows(
      sheet(['Item', 'Descripción'], [['', ''], ['K', 'Potasio']])
    );
    expect(rows).toHaveLength(1);
  });
});

describe('errorBody', () => {
  it("parses the API's JSON error body", () => {
    expect(
      errorBody(new Error('{"code":"BILLING_CODE_REPLACE_NOT_CONFIRMED"}'))
    ).toEqual({ code: 'BILLING_CODE_REPLACE_NOT_CONFIRMED' });
    expect(errorBody(new Error('plain text'))).toBeNull();
  });
});
