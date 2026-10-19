// @vitest-environment node
import ExcelJS from 'exceljs';
import {
  BILLING_HEADERS,
  billingCsv,
  billingFilename,
  billingXlsx,
} from './billingExport';
import { parseCsvText } from './spreadsheet';
import type { BillingRow } from '../types/lab.types';

const ROWS: BillingRow[] = [
  {
    fecha: '2026-10-18',
    entidad: 'Clínica "El Ñandú", Norte',
    item: '00123',
    cantidad: 1,
    patientName: 'Peña; Max\nJr.',
  },
  {
    fecha: '2026-03-08',
    entidad: 'Vet ñ',
    item: 'SDMA022720261534',
    cantidad: 2,
    patientName: 'Luna',
  },
];

async function xlsxGrid(rows: BillingRow[]): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await billingXlsx(rows));
  const sheet = workbook.worksheets[0];
  const grid: string[][] = [];
  sheet.eachRow((row) => {
    grid.push(
      [1, 2, 3, 4, 5].map((c) => String(row.getCell(c).value ?? ''))
    );
  });
  return grid;
}

function csvGrid(csv: string): string[][] {
  const sheet = parseCsvText(csv);
  return [sheet.headers, ...sheet.rows.map((r) => r.map((c) => c.text))];
}

describe('billing export files', () => {
  it('both formats have exactly the five columns, in order', async () => {
    const expected = [
      'fecha',
      'entidad',
      'item',
      'cantidad',
      'nombre del paciente',
    ];
    expect([...BILLING_HEADERS]).toEqual(expected);
    expect(csvGrid(billingCsv(ROWS))[0]).toEqual(expected);
    expect((await xlsxGrid(ROWS))[0]).toEqual(expected);
  });

  it('Excel and CSV carry identical contents', async () => {
    expect(csvGrid(billingCsv(ROWS))).toEqual(await xlsxGrid(ROWS));
  });

  it('keeps accents, commas, quotes, semicolons and line breaks', () => {
    const grid = csvGrid(billingCsv(ROWS));
    expect(grid[1][1]).toBe('Clínica "El Ñandú", Norte');
    expect(grid[1][4]).toBe('Peña; Max\nJr.');
  });

  it('CSV starts with a UTF-8 BOM and uses CRLF', () => {
    const csv = billingCsv(ROWS);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
  });

  it('keeps codes with leading zeros and the fecha exactly as text', async () => {
    expect(csvGrid(billingCsv(ROWS))[1][2]).toBe('00123');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await billingXlsx(ROWS));
    const row = workbook.worksheets[0].getRow(2);
    expect(row.getCell(3).value).toBe('00123');
    expect(typeof row.getCell(1).value).toBe('string');
    expect(row.getCell(4).value).toBe(1);
  });

  it('a value that looks like a formula is never executed', async () => {
    const rows = [{ ...ROWS[0], patientName: '=HYPERLINK("http://x")' }];
    // CSV: neutralized with a leading apostrophe
    expect(csvGrid(billingCsv(rows))[1][4]).toBe(`'=HYPERLINK("http://x")`);
    // XLSX: stored as a plain string, not a formula
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await billingXlsx(rows));
    const value = workbook.worksheets[0].getRow(2).getCell(5).value;
    expect(value).toBe('=HYPERLINK("http://x")');
  });

  it('a file with no rows still has the header', async () => {
    expect(billingCsv([])).toBe(
      '\uFEFF"fecha","entidad","item","cantidad","nombre del paciente"\r\n'
    );
    expect(await xlsxGrid([])).toEqual([[...BILLING_HEADERS]]);
  });

  it('names the file after the range', () => {
    expect(billingFilename('2026-10-01', '2026-10-31', 'xlsx')).toBe(
      'facturacion_2026-10-01_2026-10-31.xlsx'
    );
    expect(billingFilename('2026-10-18', '2026-10-18', 'csv')).toBe(
      'facturacion_2026-10-18.csv'
    );
  });
});
