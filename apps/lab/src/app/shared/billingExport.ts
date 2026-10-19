import { toCsv } from './clientImport';
import type { BillingRow } from '../types/lab.types';

/**
 * The billing file, Excel and CSV from the same rows. Exactly these five
 * columns, in this order — no prices, results or anything else:
 *
 *   fecha                 order CREATION day, "YYYY-MM-DD" (ISO 8601) in the
 *                         lab's timezone — written as text in both formats so
 *                         Excel never reinterprets it with a regional format
 *   entidad               ordering clinic / client name
 *   item                  the lab's billing code (text: leading zeros survive)
 *   cantidad              billable quantity (whole number, usually 1)
 *   nombre del paciente   patient name
 *
 * CSV is UTF-8 with a BOM (accents show correctly in Excel), CRLF line ends,
 * every value quoted and escaped; a text starting with = + - @ is prefixed
 * with ' so a spreadsheet never runs it as a formula. XLSX cells are plain
 * strings (never formulas), so only the CSV needs that prefix.
 */
export const BILLING_HEADERS = [
  'fecha',
  'entidad',
  'item',
  'cantidad',
  'nombre del paciente',
] as const;

export function billingCsv(rows: BillingRow[]): string {
  return toCsv([
    [...BILLING_HEADERS],
    ...rows.map((r) => [
      r.fecha,
      r.entidad,
      r.item,
      String(r.cantidad),
      r.patientName,
    ]),
  ]);
}

/** exceljs is loaded only when an Excel file is actually requested. */
export async function billingXlsx(rows: BillingRow[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Facturación');
  sheet.columns = BILLING_HEADERS.map((header, i) => ({
    header,
    key: header,
    width: [12, 32, 16, 10, 32][i],
    // '@' = text: dates and codes stay exactly as written
    style: i === 3 ? {} : { numFmt: '@' },
  }));
  for (const r of rows) {
    sheet.addRow({
      fecha: r.fecha,
      entidad: r.entidad,
      item: r.item,
      cantidad: r.cantidad,
      'nombre del paciente': r.patientName,
    });
  }
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export type BillingFormat = 'xlsx' | 'csv';

export function billingFilename(
  dateFrom: string,
  dateTo: string,
  format: BillingFormat
): string {
  const range = dateFrom === dateTo ? dateFrom : `${dateFrom}_${dateTo}`;
  return `facturacion_${range}.${format}`;
}

/** Browser download through a Blob URL. */
export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadBillingFile(
  rows: BillingRow[],
  format: BillingFormat,
  filename: string
) {
  if (format === 'csv') {
    downloadBlob(billingCsv(rows), filename, 'text/csv;charset=utf-8');
    return;
  }
  downloadBlob(
    await billingXlsx(rows),
    filename,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}
