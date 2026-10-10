import type {
  ClientType,
  ColumnMapping,
  ImportBucket,
  ImportField,
  ImportIssue,
  ImportPreviewRow,
  ImportRequestRow,
  ImportRowResult,
  ImportRowValues,
  ParsedSheet,
} from '../types/lab.types';
import { COUNTRY_CODES, countryName } from './countries';
import { isTaxIdTypeForCountry, matchTaxIdType } from './taxIdTypes';
import { looksLikeScientificNotation } from './spreadsheet';

/**
 * Pure logic of the client bulk import (docs/CLIENT_BULK_IMPORT_PLAN.md):
 * header guessing (A8), value normalization, row checks (A3/A6), in-file
 * duplicates and preview buckets (A4), the retry file (A7) and the group
 * runner (A5). No React, no fetch — everything here is unit-tested.
 */

export const CLIENT_TYPES: ClientType[] = [
  'VETERINARY_CLINIC',
  'INDEPENDENT_VET',
  'BREEDER',
  'FARM',
  'SHELTER',
  'RESEARCH_ORGANIZATION',
  'INDIVIDUAL',
  'OTHER',
];

/** Field order of the template, the retry file and the mapping select. */
export const IMPORT_FIELDS: ImportField[] = [
  'name',
  'legalName',
  'primaryContactName',
  'primaryContactEmail',
  'phone',
  'address',
  'city',
  'country',
  'clientType',
  'taxIdType',
  'taxId',
  'notes',
];

/** Rows per import request; the API accepts up to 50 (A5). */
export const IMPORT_CHUNK_SIZE = 25;
/** Rows per dry-run request. */
export const DRY_RUN_CHUNK_SIZE = 50;

/** Same limits as the API's ClientFieldsDto. */
const MAX_LENGTH: Partial<Record<ImportField, number>> = {
  name: 200,
  legalName: 200,
  primaryContactName: 200,
  primaryContactEmail: 254,
  phone: 50,
  address: 500,
  city: 100,
  taxIdType: 20,
  taxId: 50,
  notes: 5000,
};

/** Template headers in one language, e.g. from i18n clients.import.template. */
export type TemplateHeaders = Record<ImportField, string>;

// ---------------------------------------------------------------------------
// Header guessing (A8)
// ---------------------------------------------------------------------------

/** Lowercase, no accents, punctuation → single spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Header aliases (normalized) in ES / PT / EN. `exact` must equal the whole
 * header; `contains` may appear inside it as whole words. Notes and Client
 * type are never guessed — only our own template headers map to them.
 */
const HEADER_ALIASES: Record<
  Exclude<ImportField, 'notes' | 'clientType'>,
  { exact: string[]; contains: string[] }
> = {
  name: {
    exact: [
      'nombre',
      'nombre comercial',
      'nombre de la clinica',
      'nombre clinica',
      'nombre del cliente',
      'cliente',
      'clinica',
      'veterinaria',
      'name',
      'client name',
      'clinic name',
      'business name',
      'trade name',
      'nome',
      'nome fantasia',
      'nome da clinica',
    ],
    contains: [
      'nombre comercial',
      'nome fantasia',
      'clinic name',
      'trade name',
    ],
  },
  legalName: {
    exact: [
      'razon social',
      'nombre legal',
      'denominacion social',
      'legal name',
      'company name',
      'razao social',
    ],
    contains: ['razon social', 'razao social', 'legal name'],
  },
  primaryContactName: {
    exact: [
      'contacto',
      'nombre de contacto',
      'persona de contacto',
      'responsable',
      'contact',
      'contact name',
      'primary contact',
      'contato',
      'nome do contato',
    ],
    contains: [
      'nombre de contacto',
      'persona de contacto',
      'contact name',
      'nome do contato',
    ],
  },
  primaryContactEmail: {
    exact: [
      'email',
      'e mail',
      'correo',
      'correo electronico',
      'correo de contacto',
      'email de contacto',
      'mail',
      'email address',
      'e mail address',
    ],
    contains: ['correo', 'email', 'e mail'],
  },
  phone: {
    exact: [
      'telefono',
      'numero de telefono',
      'celular',
      'movil',
      'whatsapp',
      'tel',
      'phone',
      'phone number',
      'mobile',
      'telefone',
    ],
    contains: ['telefono', 'celular', 'whatsapp', 'movil', 'phone', 'telefone'],
  },
  address: {
    exact: [
      'direccion',
      'direccion principal',
      'domicilio',
      'address',
      'endereco',
    ],
    // Not bare "direccion": "Dirección de correo electrónico" is an email.
    contains: ['direccion principal', 'domicilio', 'address', 'endereco'],
  },
  city: {
    exact: ['ciudad', 'municipio', 'localidad', 'city', 'cidade'],
    contains: ['ciudad', 'city', 'cidade'],
  },
  country: {
    exact: ['pais', 'country'],
    contains: ['pais', 'country'],
  },
  taxIdType: {
    exact: [
      'tipo de identificacion',
      'tipo identificacion',
      'tipo de documento',
      'tipo documento',
      'tipo de id',
      'id type',
      'document type',
      'tax id type',
    ],
    contains: [
      'tipo de identificacion',
      'tipo de documento',
      'id type',
      'document type',
    ],
  },
  taxId: {
    exact: [
      'numero de identificacion',
      'numero identificacion',
      'nro de identificacion',
      'no de identificacion',
      'identificacion',
      'numero de documento',
      'documento',
      'cedula',
      'nit',
      'rut',
      'cuit',
      'ruc',
      'cnpj',
      'cpf',
      'rfc',
      'id number',
      'tax id',
    ],
    contains: [
      'numero de identificacion',
      'nro de identificacion',
      'numero de documento',
      'id number',
      'tax id',
    ],
  },
};

const containsPhrase = (header: string, phrase: string) =>
  ` ${header} `.includes(` ${phrase} `);

/**
 * Suggested field per column. Every column starts on Ignore; a field is
 * suggested for at most one column, best match first (our template header >
 * exact alias > alias inside the header), ties to the leftmost column.
 */
export function guessMapping(
  headers: string[],
  templates: TemplateHeaders[]
): ColumnMapping[] {
  const normalized = headers.map(normalizeText);
  const candidates: { field: ImportField; col: number; score: number }[] = [];

  normalized.forEach((header, col) => {
    if (!header) return;
    for (const template of templates) {
      for (const field of IMPORT_FIELDS) {
        if (normalizeText(template[field]) === header) {
          candidates.push({ field, col, score: 3 });
        }
      }
    }
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.exact.includes(header)) {
        candidates.push({ field: field as ImportField, col, score: 2 });
      } else if (aliases.contains.some((a) => containsPhrase(header, a))) {
        candidates.push({ field: field as ImportField, col, score: 1 });
      }
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping: ColumnMapping[] = headers.map(() => 'ignore');
  const used = new Set<ImportField>();
  for (const { field, col } of candidates) {
    if (mapping[col] !== 'ignore' || used.has(field)) continue;
    mapping[col] = field;
    used.add(field);
  }
  return mapping;
}

/** Selecting a field for one column releases it from any other (except Notes). */
export function setColumnMapping(
  mapping: ColumnMapping[],
  col: number,
  value: ColumnMapping
): ColumnMapping[] {
  return mapping.map((m, i) => {
    if (i === col) return value;
    if (value !== 'ignore' && value !== 'notes' && m === value) return 'ignore';
    return m;
  });
}

export type MappingProblem = 'EMAIL_REQUIRED' | 'NAME_REQUIRED';

export function mappingProblems(mapping: ColumnMapping[]): MappingProblem[] {
  const problems: MappingProblem[] = [];
  if (!mapping.includes('primaryContactEmail')) problems.push('EMAIL_REQUIRED');
  if (!mapping.includes('name') && !mapping.includes('legalName')) {
    problems.push('NAME_REQUIRED');
  }
  return problems;
}

/** First few non-empty values of a column, for the mapping step. */
export function sampleValues(sheet: ParsedSheet, col: number, count = 3) {
  const samples: string[] = [];
  for (const row of sheet.rows) {
    const value = row[col]?.text.trim();
    if (value) samples.push(value);
    if (samples.length === count) break;
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Saved mapping (per lab and header set)
// ---------------------------------------------------------------------------

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function mappingStorageKey(tenantId: string, headers: string[]) {
  return `clientImport.mapping.${tenantId}.${hashString(
    headers.map(normalizeText).join('\u0000')
  )}`;
}

const MAPPING_VALUES = new Set<string>([...IMPORT_FIELDS, 'ignore']);

export function loadSavedMapping(
  tenantId: string,
  headers: string[]
): ColumnMapping[] | null {
  try {
    const raw = localStorage.getItem(mappingStorageKey(tenantId, headers));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === headers.length &&
      parsed.every((v) => typeof v === 'string' && MAPPING_VALUES.has(v))
    ) {
      return parsed as ColumnMapping[];
    }
  } catch {
    // storage blocked or corrupt — fall back to guessing
  }
  return null;
}

export function saveMapping(
  tenantId: string,
  headers: string[],
  mapping: ColumnMapping[]
) {
  try {
    localStorage.setItem(
      mappingStorageKey(tenantId, headers),
      JSON.stringify(mapping)
    );
  } catch {
    // storage blocked — the mapping just isn't remembered
  }
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

const NAME_LANGUAGES = ['en', 'es', 'pt'];

/** "CO", "co", "Colombia" → "CO". Null when not one of our countries. */
export function matchCountry(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if ((COUNTRY_CODES as readonly string[]).includes(upper)) return upper;
  const wanted = normalizeText(text);
  return (
    COUNTRY_CODES.find((code) =>
      NAME_LANGUAGES.some(
        (lang) => normalizeText(countryName(code, lang)) === wanted
      )
    ) ?? null
  );
}

/** Code ("VETERINARY_CLINIC") or a translated label → code. */
export function matchClientType(
  value: string,
  labels: Record<ClientType, string>[]
): ClientType | null {
  const wanted = normalizeText(value);
  if (!wanted) return null;
  return (
    CLIENT_TYPES.find(
      (code) =>
        normalizeText(code) === wanted ||
        labels.some((l) => normalizeText(l[code] ?? '') === wanted)
    ) ?? null
  );
}

/** Same comparison key as the API: uppercase, no spaces . - / */
export function normalizeTaxId(value: string): string {
  return value.toUpperCase().replace(/[\s.\-/]/g, '');
}

export interface BuildRowsOptions {
  defaults: { clientType: ClientType; country: string };
  clientTypeLabels: Record<ClientType, string>[];
  /** Notes headers of our own template: their values go in without a prefix */
  templateNotesHeaders: string[];
}

const EMPTY_VALUES: ImportRowValues = {
  name: '',
  legalName: '',
  primaryContactName: '',
  primaryContactEmail: '',
  phone: '',
  address: '',
  city: '',
  country: '',
  clientType: '',
  taxIdType: '',
  taxId: '',
  notes: '',
};

/** Mapped file rows → preview rows. Values that can't be matched stay as typed. */
export function buildPreviewRows(
  sheet: ParsedSheet,
  mapping: ColumnMapping[],
  options: BuildRowsOptions
): ImportPreviewRow[] {
  const templateNotes = new Set(
    options.templateNotesHeaders.map(normalizeText)
  );

  return sheet.rows.map((cells, i) => {
    const values: ImportRowValues = { ...EMPTY_VALUES };
    const sources: ImportPreviewRow['sources'] = {};
    const notes: string[] = [];

    mapping.forEach((field, col) => {
      if (field === 'ignore') return;
      const cell = cells[col];
      const value = cell?.text.trim() ?? '';
      if (field === 'notes') {
        if (!value) return;
        const header = sheet.headers[col] ?? '';
        notes.push(
          templateNotes.has(normalizeText(header))
            ? value
            : `${header}: ${value}`
        );
        return;
      }
      values[field] = value;
      if (cell) sources[field] = cell.source;
    });
    values.notes = notes.join('\n');

    // An empty Name falls back to the legal name.
    if (!values.name) values.name = values.legalName;
    values.country = values.country
      ? matchCountry(values.country) ?? values.country
      : options.defaults.country;
    values.clientType = values.clientType
      ? matchClientType(values.clientType, options.clientTypeLabels) ??
        values.clientType
      : options.defaults.clientType;
    if (values.taxIdType) {
      values.taxIdType =
        matchTaxIdType(values.taxIdType, values.country) ?? values.taxIdType;
    }

    return {
      rowNumber: sheet.rowNumbers[i],
      values,
      sources,
      excluded: false,
      confirmedWarnings: [],
      check: null,
      imported: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Row checks (A3, A6, A7)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Leading "'" before a formula character — probably added by an export. */
const APOSTROPHE_RE = /^'[=+\-@\t\r]/;

const NUMBER_CHECKED_FIELDS: ImportField[] = ['phone', 'taxId'];

/** Browser-side checks. The server checks again; this only improves the preview. */
export function rowIssues(row: ImportPreviewRow): ImportIssue[] {
  const v = row.values;
  const issues: ImportIssue[] = [];
  const error = (field: ImportField, code: ImportIssue['code']) =>
    issues.push({ field, code, severity: 'error' });
  const warning = (field: ImportField, code: ImportIssue['code']) =>
    issues.push({ field, code, severity: 'warning' });

  if (!v.name) error('name', 'REQUIRED');
  if (!v.primaryContactEmail) error('primaryContactEmail', 'REQUIRED');
  else if (!EMAIL_RE.test(v.primaryContactEmail)) {
    error('primaryContactEmail', 'INVALID_EMAIL');
  }
  for (const field of IMPORT_FIELDS) {
    const max = MAX_LENGTH[field];
    if (max && v[field].length > max) error(field, 'TOO_LONG');
  }
  if (v.country && !(COUNTRY_CODES as readonly string[]).includes(v.country)) {
    error('country', 'INVALID_COUNTRY');
  }
  if (!CLIENT_TYPES.includes(v.clientType as ClientType)) {
    error('clientType', 'INVALID_CLIENT_TYPE');
  }
  if (v.taxIdType && !isTaxIdTypeForCountry(v.taxIdType, v.country)) {
    error('taxIdType', 'INVALID_TAX_ID_TYPE');
  }
  if (v.taxId) {
    if (!v.taxIdType || !v.country) error('taxId', 'TAX_ID_INCOMPLETE');
    else if (!normalizeTaxId(v.taxId)) error('taxId', 'INVALID_TAX_ID');
  }

  for (const field of NUMBER_CHECKED_FIELDS) {
    if (!v[field]) continue;
    const source = row.sources[field];
    if (source === 'unsafe_number') error(field, 'NUMBER_ROUNDED');
    else if (looksLikeScientificNotation(v[field])) {
      error(field, 'SCIENTIFIC_NOTATION');
    } else if (source === 'number') warning(field, 'NUMBER_STORED');
  }
  for (const field of IMPORT_FIELDS) {
    if (APOSTROPHE_RE.test(v[field])) warning(field, 'APOSTROPHE_PREFIX');
  }
  return issues;
}

export const warningKey = (issue: ImportIssue) =>
  `${issue.field}:${issue.code}`;

export function unconfirmedWarnings(
  row: ImportPreviewRow,
  issues: ImportIssue[]
): ImportIssue[] {
  return issues.filter(
    (i) =>
      i.severity === 'warning' && !row.confirmedWarnings.includes(warningKey(i))
  );
}

/** Explicit action only — uploaded values are never changed automatically. */
export function removeLeadingApostrophe(value: string): string {
  return value.replace(/^'(?=[=+\-@\t\r])/, '');
}

/**
 * Applies an edit. The value came from the user, so the file's cell source
 * (and its number warnings) no longer applies to that field.
 */
export function editRow(
  row: ImportPreviewRow,
  changes: Partial<ImportRowValues>
): ImportPreviewRow {
  const sources = { ...row.sources };
  for (const field of Object.keys(changes) as ImportField[]) {
    if (changes[field] !== row.values[field]) delete sources[field];
  }
  return { ...row, values: { ...row.values, ...changes }, sources };
}

// ---------------------------------------------------------------------------
// Duplicates in the file and preview buckets (A4)
// ---------------------------------------------------------------------------

export const emailKey = (email: string) => email.trim().toLowerCase();

export function taxKey(v: ImportRowValues): string | null {
  const normalized = normalizeTaxId(v.taxId);
  if (!v.country || !v.taxIdType || !normalized) return null;
  return `${v.country}|${v.taxIdType}|${normalized}`;
}

/**
 * Row numbers that repeat the email or tax ID of an earlier row (first row
 * wins). Recomputed for all rows after every edit: fixing one row can clear
 * or create a duplicate in another.
 */
export function inFileDuplicates(rows: ImportPreviewRow[]): Set<number> {
  const duplicates = new Set<number>();
  const emails = new Set<string>();
  const taxKeys = new Set<string>();
  for (const row of rows) {
    if (row.excluded) continue;
    if (rowIssues(row).some((i) => i.severity === 'error')) continue;
    const email = emailKey(row.values.primaryContactEmail);
    const tax = taxKey(row.values);
    if (emails.has(email) || (tax !== null && taxKeys.has(tax))) {
      duplicates.add(row.rowNumber);
      continue;
    }
    emails.add(email);
    if (tax !== null) taxKeys.add(tax);
  }
  return duplicates;
}

/** Values a dry-run result depends on — editing any of them re-checks the row. */
export function checkKey(v: ImportRowValues): string {
  return JSON.stringify([
    v.name.trim(),
    emailKey(v.primaryContactEmail),
    v.country,
    v.taxIdType,
    normalizeTaxId(v.taxId),
  ]);
}

function resultBucket(result: ImportRowResult): ImportBucket {
  switch (result.status) {
    case 'created':
      return 'created';
    case 'would_create':
      return 'will_create';
    case 'skipped':
      return result.reason === 'DUPLICATE_IN_FILE'
        ? 'duplicate_in_file'
        : 'already_in_lab';
    case 'invalid':
      return 'invalid';
    default:
      return 'failed';
  }
}

export function rowBucket(
  row: ImportPreviewRow,
  duplicates: Set<number>
): ImportBucket {
  if (row.imported === 'not_confirmed') return 'not_confirmed';
  if (row.imported) return resultBucket(row.imported);
  if (row.excluded) return 'excluded';
  const issues = rowIssues(row);
  if (issues.some((i) => i.severity === 'error')) return 'invalid';
  if (duplicates.has(row.rowNumber)) return 'duplicate_in_file';
  if (unconfirmedWarnings(row, issues).length > 0) return 'needs_review';
  if (!row.check || row.check.key !== checkKey(row.values)) return 'checking';
  return resultBucket(row.check.result);
}

/** Errors the server reported for this row, from the import or the dry run. */
export function serverErrors(row: ImportPreviewRow) {
  const result =
    row.imported && row.imported !== 'not_confirmed'
      ? row.imported
      : row.check?.key === checkKey(row.values)
      ? row.check.result
      : null;
  return result?.status === 'invalid' ? result.errors : [];
}

export function toRequestRow(row: ImportPreviewRow): ImportRequestRow {
  const v = row.values;
  const optional = (value: string) => value.trim() || undefined;
  return {
    rowNumber: row.rowNumber,
    name: v.name,
    clientType: v.clientType,
    primaryContactEmail: v.primaryContactEmail,
    primaryContactName: optional(v.primaryContactName),
    phone: optional(v.phone),
    address: optional(v.address),
    city: optional(v.city),
    country: optional(v.country),
    legalName: optional(v.legalName),
    taxIdType: optional(v.taxIdType),
    taxId: optional(v.taxId),
    notes: optional(v.notes),
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// CSV writing — retry file / template (A7)
// ---------------------------------------------------------------------------

/**
 * RFC 4180 field, always quoted. A value starting with = + - @, tab or CR
 * gets a leading "'" so spreadsheets don't run it as a formula (OWASP CSV
 * injection) — every value, phones like "+57 300…" included.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM (so Excel shows accents) + CRLF line ends. */
export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function templateCsv(headers: TemplateHeaders): string {
  return toCsv([IMPORT_FIELDS.map((f) => headers[f])]);
}

export interface RetryFileOptions {
  headers: TemplateHeaders & { status: string; reason: string };
  clientTypeLabel: (code: string) => string;
  statusLabel: (row: ImportPreviewRow) => string;
  reasonLabel: (row: ImportPreviewRow) => string;
}

/**
 * Every row that wasn't created, with the user's corrections (the current
 * preview values, never the originals), under our template headers so the
 * mapping is recognized when it's imported again.
 */
export function buildRetryCsv(
  rows: ImportPreviewRow[],
  options: RetryFileOptions
): string {
  const header = [
    ...IMPORT_FIELDS.map((f) => options.headers[f]),
    options.headers.status,
    options.headers.reason,
  ];
  const body = rows
    .filter(
      (r) =>
        !(
          r.imported &&
          r.imported !== 'not_confirmed' &&
          r.imported.status === 'created'
        )
    )
    .map((row) => [
      ...IMPORT_FIELDS.map((field) =>
        field === 'clientType'
          ? options.clientTypeLabel(row.values.clientType)
          : row.values[field]
      ),
      options.statusLabel(row),
      options.reasonLabel(row),
    ]);
  return toCsv([header, ...body]);
}

// ---------------------------------------------------------------------------
// Group runner (A5)
// ---------------------------------------------------------------------------

/** Network errors, timeouts and 5xx are worth retrying; 4xx are not. */
export function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') {
    return status >= 500 || status === 408 || status === 429;
  }
  return true; // fetch rejected: network error / connection dropped
}

export interface RunGroupsOptions {
  rows: ImportRequestRow[];
  send: (rows: ImportRequestRow[]) => Promise<{ results: ImportRowResult[] }>;
  groupSize?: number;
  /** Wait before each retry; its length is the number of retries */
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  /** Called after every confirmed group, for progress */
  onGroup?: (results: ImportRowResult[]) => void;
}

/**
 * Sends groups one after another. A failed group is retried with the same
 * request (same batch id — the API's replay rule makes that safe). When the
 * retries run out, the runner stops and returns the rows it couldn't confirm.
 */
export async function runImportGroups({
  rows,
  send,
  groupSize = IMPORT_CHUNK_SIZE,
  retryDelaysMs = [1000, 3000],
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onGroup,
}: RunGroupsOptions): Promise<{
  results: ImportRowResult[];
  notConfirmed: ImportRequestRow[];
  error?: unknown;
}> {
  const groups = chunk(rows, groupSize);
  const results: ImportRowResult[] = [];

  for (let g = 0; g < groups.length; g++) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await send(groups[g]);
        results.push(...response.results);
        onGroup?.(response.results);
        break;
      } catch (err) {
        if (attempt < retryDelaysMs.length && isRetryableError(err)) {
          await sleep(retryDelaysMs[attempt]);
          continue;
        }
        return { results, notConfirmed: groups.slice(g).flat(), error: err };
      }
    }
  }
  return { results, notConfirmed: [] };
}
