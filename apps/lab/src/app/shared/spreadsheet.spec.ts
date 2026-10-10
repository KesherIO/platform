// @vitest-environment node
import ExcelJS from 'exceljs';
import {
  MAX_IMPORT_ROWS,
  SpreadsheetParseError,
  decodeCsv,
  looksLikeScientificNotation,
  parseCsvText,
  parseXlsxBuffer,
  xlsxCell,
} from './spreadsheet';

describe('parseCsvText', () => {
  it('handles a BOM, a ";" separator and quoted multi-line fields', () => {
    const sheet = parseCsvText(
      '﻿Nombre;Comentarios\r\n"Vet ""Norte""";"línea 1\nlínea 2"\r\n'
    );

    expect(sheet.headers).toEqual(['Nombre', 'Comentarios']);
    expect(sheet.rows[0].map((c) => c.text)).toEqual([
      'Vet "Norte"',
      'línea 1\nlínea 2',
    ]);
    expect(sheet.rowNumbers).toEqual([2]);
  });

  it('keeps IDs exactly as text', () => {
    const sheet = parseCsvText('id,nit\n00123,12.345.678-K\n');

    expect(sheet.rows[0]).toEqual([
      { text: '00123', source: 'text' },
      { text: '12.345.678-K', source: 'text' },
    ]);
  });

  it('drops empty rows and empty columns but keeps file row numbers', () => {
    const sheet = parseCsvText('a,,b\n1,,2\n,,\n3,,4\n');

    expect(sheet.headers).toEqual(['a', 'b']);
    expect(sheet.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(sheet.rowNumbers).toEqual([2, 4]);
  });

  it.each([
    ['', 'EMPTY_FILE'],
    ['name,email\n', 'NO_DATA_ROWS'],
    [`name\n${'x\n'.repeat(MAX_IMPORT_ROWS + 1)}`, 'TOO_MANY_ROWS'],
  ])('rejects %j with %s', (csv, code) => {
    expect(() => parseCsvText(csv)).toThrow(
      expect.objectContaining({ code }) as SpreadsheetParseError
    );
  });
});

describe('decodeCsv', () => {
  it('reads UTF-8 and falls back to Windows-1252 for Excel "CSV" files', () => {
    const utf8 = new TextEncoder().encode('﻿Cédula').buffer;
    const latin1 = new Uint8Array([0x43, 0xe9, 0x64, 0x75, 0x6c, 0x61]).buffer;

    expect(decodeCsv(utf8)).toBe('Cédula');
    expect(decodeCsv(latin1)).toBe('Cédula');
  });
});

describe('looksLikeScientificNotation', () => {
  it.each(['1.09874E+09', '1,09874E+09', '9E15'])('%s → true', (v) => {
    expect(looksLikeScientificNotation(v)).toBe(true);
  });
  it.each(['1098745632', 'E-mail', '12.345.678-K'])('%s → false', (v) => {
    expect(looksLikeScientificNotation(v)).toBe(false);
  });
});

describe('xlsxCell', () => {
  it('pads a number with a zero-padding format to its width', () => {
    expect(xlsxCell(12345, '0000000000')).toEqual({
      text: '0000012345',
      source: 'padded_number',
    });
  });

  it('marks plain numbers, and numbers Excel may have rounded', () => {
    expect(xlsxCell(1098765432, 'General')).toEqual({
      text: '1098765432',
      source: 'number',
    });
    expect(xlsxCell(1234567890123456, undefined).source).toBe('unsafe_number');
  });

  it('uses the cached result of a formula and the text of rich text', () => {
    expect(xlsxCell({ formula: 'A1&""', result: '00123' })).toEqual({
      text: '00123',
      source: 'text',
    });
    expect(
      xlsxCell({ richText: [{ text: 'Vet ' }, { text: 'Norte' }] }).text
    ).toBe('Vet Norte');
    expect(
      xlsxCell({ text: 'info@vet.co', hyperlink: 'mailto:info@vet.co' }).text
    ).toBe('info@vet.co');
  });
});

describe('parseXlsxBuffer', () => {
  it('reads the first sheet with the number rules above', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Clientes');
    sheet.addRow(['Nombre', 'NIT', 'Cédula', 'Teléfono', 'Largo']);
    const row = sheet.addRow([
      'Vet Norte',
      '900.123.456-7',
      12345,
      3001234567,
      1234567890123456,
    ]);
    row.getCell(3).numFmt = '0000000000';
    workbook.addWorksheet('Otra').addRow(['ignored']);
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const parsed = await parseXlsxBuffer(buffer);

    expect(parsed.headers).toEqual([
      'Nombre',
      'NIT',
      'Cédula',
      'Teléfono',
      'Largo',
    ]);
    expect(parsed.rows[0]).toEqual([
      { text: 'Vet Norte', source: 'text' },
      { text: '900.123.456-7', source: 'text' },
      { text: '0000012345', source: 'padded_number' },
      { text: '3001234567', source: 'number' },
      { text: '1234567890123456', source: 'unsafe_number' },
    ]);
  });

  it('rejects a file that is not an xlsx', async () => {
    await expect(
      parseXlsxBuffer(new TextEncoder().encode('not a zip').buffer)
    ).rejects.toThrow(SpreadsheetParseError);
  });
});
