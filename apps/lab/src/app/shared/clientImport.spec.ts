import en from '../../assets/i18n/en.json';
import es from '../../assets/i18n/es.json';
import {
  buildPreviewRows,
  buildRetryCsv,
  checkKey,
  editRow,
  guessMapping,
  inFileDuplicates,
  mappingProblems,
  removeLeadingApostrophe,
  rowBucket,
  rowIssues,
  runImportGroups,
  setColumnMapping,
  toRequestRow,
  type BuildRowsOptions,
  type TemplateHeaders,
} from './clientImport';
import { parseCsvText } from './spreadsheet';
import type {
  ClientType,
  ColumnMapping,
  ImportPreviewRow,
  ImportRequestRow,
  ParsedSheet,
  SheetCell,
} from '../types/lab.types';

const TEMPLATES: TemplateHeaders[] = [
  en.clients.import.template,
  es.clients.import.template,
];
const OPTIONS: BuildRowsOptions = {
  defaults: { clientType: 'VETERINARY_CLINIC', country: 'CO' },
  clientTypeLabels: [
    en.clients.type as Record<ClientType, string>,
    es.clients.type as Record<ClientType, string>,
  ],
  templateNotesHeaders: TEMPLATES.map((t) => t.notes),
};

const cell = (
  text: string,
  source: SheetCell['source'] = 'text'
): SheetCell => ({
  text,
  source,
});

function sheetOf(
  headers: string[],
  ...rows: (string | SheetCell)[][]
): ParsedSheet {
  return {
    headers,
    rows: rows.map((r) => r.map((v) => (typeof v === 'string' ? cell(v) : v))),
    rowNumbers: rows.map((_, i) => i + 2),
  };
}

/** A preview row with valid values, for tests that edit one thing. */
function previewRow(
  rowNumber: number,
  overrides: Partial<ImportPreviewRow['values']> = {}
) {
  const [row] = buildPreviewRows(
    sheetOf(
      ['Name', 'Email'],
      [`Clinic ${rowNumber}`, `clinic${rowNumber}@example.com`]
    ),
    ['name', 'primaryContactEmail'],
    OPTIONS
  );
  return { ...row, rowNumber, values: { ...row.values, ...overrides } };
}

describe('guessMapping', () => {
  // Real headers of the first lab's Google Form export.
  const FIRST_LAB_HEADERS = [
    'Marca temporal',
    'Dirección de correo electrónico',
    'NOMBRE COMERCIAL',
    'NOMBRE COMPLETO / RAZON SOCIAL',
    'TIPO DE PERSONA',
    'TIPO DE IDENTIFICACION',
    'NUMERO DE IDENTIFICACION',
    'Correo electrónico',
    'Número de teléfono',
    'DIRECCION PRINCIPAL',
    'CIUDAD',
    'FACTURACION',
    'ADJUNTAR RUT',
    'Comentarios',
    'SOLCITUD',
    'CREADO EN LA PLATAFORMA?',
  ];

  it("maps the first lab's file, leaving the form submitter's email ignored", () => {
    expect(guessMapping(FIRST_LAB_HEADERS, TEMPLATES)).toEqual([
      'ignore',
      'ignore', // form submitter, not the client
      'name',
      'legalName',
      'ignore',
      'taxIdType',
      'taxId',
      'primaryContactEmail',
      'phone',
      'address',
      'city',
      'ignore',
      'ignore',
      'ignore', // Comentarios: Notes only if the user maps it
      'ignore',
      'ignore',
    ]);
  });

  it('recognizes Portuguese and English headers', () => {
    expect(
      guessMapping(
        [
          'Nome fantasia',
          'Razão social',
          'E-mail',
          'Telefone',
          'Endereço',
          'Cidade',
          'CNPJ',
        ],
        TEMPLATES
      )
    ).toEqual([
      'name',
      'legalName',
      'primaryContactEmail',
      'phone',
      'address',
      'city',
      'taxId',
    ]);
    expect(
      guessMapping(
        ['Clinic name', 'Email address', 'Phone number', 'Country', 'Tax ID'],
        TEMPLATES
      )
    ).toEqual(['name', 'primaryContactEmail', 'phone', 'country', 'taxId']);
  });

  it('never guesses Notes or Client type from other headers', () => {
    expect(
      guessMapping(
        ['Comentarios', 'Observaciones', 'FACTURACION', 'Category', 'Tipo'],
        TEMPLATES
      )
    ).toEqual(['ignore', 'ignore', 'ignore', 'ignore', 'ignore']);
  });

  it('maps every column of our own template (the retry file), in either language', () => {
    for (const template of TEMPLATES) {
      const headers = [...Object.values(template)];
      const mapping = guessMapping(headers, TEMPLATES);
      expect(mapping.slice(0, 12)).toEqual(Object.keys(template).slice(0, 12));
    }
    expect(
      guessMapping(
        [en.clients.import.template.status, en.clients.import.template.reason],
        TEMPLATES
      )
    ).toEqual(['ignore', 'ignore']);
  });

  it('suggests each field for one column only', () => {
    expect(guessMapping(['Email', 'Correo'], TEMPLATES)).toEqual([
      'primaryContactEmail',
      'ignore',
    ]);
  });
});

describe('setColumnMapping / mappingProblems', () => {
  it('moves a field from another column, but Notes can be on several', () => {
    const start: ColumnMapping[] = ['name', 'notes', 'ignore'];
    expect(setColumnMapping(start, 2, 'name')).toEqual([
      'ignore',
      'notes',
      'name',
    ]);
    expect(setColumnMapping(start, 2, 'notes')).toEqual([
      'name',
      'notes',
      'notes',
    ]);
  });

  it('needs Email and Name or Legal name', () => {
    expect(mappingProblems(['name'])).toEqual(['EMAIL_REQUIRED']);
    expect(mappingProblems(['primaryContactEmail'])).toEqual(['NAME_REQUIRED']);
    expect(mappingProblems(['legalName', 'primaryContactEmail'])).toEqual([]);
  });
});

describe('buildPreviewRows', () => {
  it('joins only the columns mapped to Notes, as "Header: value" lines', () => {
    const [row] = buildPreviewRows(
      sheetOf(
        ['Name', 'Email', 'Comentarios', 'FACTURACION', 'SOLCITUD'],
        ['Vet', 'v@x.co', 'Paga mensual', 'Crédito', '']
      ),
      ['name', 'primaryContactEmail', 'notes', 'ignore', 'notes'],
      OPTIONS
    );
    expect(row.values.notes).toBe('Comentarios: Paga mensual');
  });

  it("keeps our template's Notes column as is", () => {
    const [row] = buildPreviewRows(
      sheetOf(
        ['Name', 'Email', 'Notes'],
        ['Vet', 'v@x.co', 'Comentarios: Paga mensual']
      ),
      ['name', 'primaryContactEmail', 'notes'],
      OPTIONS
    );
    expect(row.values.notes).toBe('Comentarios: Paga mensual');
  });

  it('normalizes country, client type and ID type, with batch defaults', () => {
    const rows = buildPreviewRows(
      sheetOf(
        ['Nombre', 'Razón social', 'Email', 'País', 'Tipo', 'Tipo id'],
        ['', 'Vet SAS', 'a@x.co', 'Colombia', 'Clínica veterinaria', 'CEDULA'],
        ['Vet B', '', 'b@x.co', 'ecuador', 'Breeder', 'Cédula'],
        ['Vet C', '', 'c@x.co', '', '', 'nit'],
        ['Vet D', '', 'd@x.co', 'Narnia', 'Zoo', 'PERSONA']
      ),
      [
        'name',
        'legalName',
        'primaryContactEmail',
        'country',
        'clientType',
        'taxIdType',
      ],
      OPTIONS
    );

    expect(
      rows.map((r) => [
        r.values.name,
        r.values.country,
        r.values.clientType,
        r.values.taxIdType,
      ])
    ).toEqual([
      ['Vet SAS', 'CO', 'VETERINARY_CLINIC', 'CC'], // empty Name falls back to legal name
      ['Vet B', 'EC', 'BREEDER', 'CI'], // "Cédula" is CI in Ecuador
      ['Vet C', 'CO', 'VETERINARY_CLINIC', 'NIT'], // defaults
      ['Vet D', 'Narnia', 'Zoo', 'PERSONA'], // kept as typed → invalid
    ]);
    expect(rowIssues(rows[3]).map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'INVALID_COUNTRY',
        'INVALID_CLIENT_TYPE',
        'INVALID_TAX_ID_TYPE',
      ])
    );
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5]);
  });

  it('keeps a leading apostrophe from the file until the user removes it', () => {
    const [row] = buildPreviewRows(
      sheetOf(
        ['Name', 'Email', 'Phone'],
        ['Vet', 'v@x.co', "'+57 300 123 4567"]
      ),
      ['name', 'primaryContactEmail', 'phone'],
      OPTIONS
    );
    expect(row.values.phone).toBe("'+57 300 123 4567");
    expect(rowIssues(row)).toContainEqual({
      field: 'phone',
      code: 'APOSTROPHE_PREFIX',
      severity: 'warning',
    });

    const fixed = editRow(row, {
      phone: removeLeadingApostrophe(row.values.phone),
    });
    expect(fixed.values.phone).toBe('+57 300 123 4567');
    expect(rowIssues(fixed)).toEqual([]);
  });
});

describe('rowIssues', () => {
  const withId = (taxId: SheetCell, phone: SheetCell = cell('')) =>
    buildPreviewRows(
      sheetOf(
        ['Name', 'Email', 'Type', 'ID', 'Phone'],
        ['Vet', 'v@x.co', 'NIT', taxId, phone]
      ),
      ['name', 'primaryContactEmail', 'taxIdType', 'taxId', 'phone'],
      OPTIONS
    )[0];

  it('warns about IDs and phones stored as numbers in Excel', () => {
    expect(
      rowIssues(
        withId(cell('900123456', 'number'), cell('3001234567', 'number'))
      )
    ).toEqual([
      { field: 'phone', code: 'NUMBER_STORED', severity: 'warning' },
      { field: 'taxId', code: 'NUMBER_STORED', severity: 'warning' },
    ]);
    expect(rowIssues(withId(cell('0000012345', 'padded_number')))).toEqual([]);
  });

  it('rejects numbers Excel may have rounded and scientific notation', () => {
    expect(
      rowIssues(withId(cell('1234567890123456', 'unsafe_number')))[0]
    ).toMatchObject({
      code: 'NUMBER_ROUNDED',
      severity: 'error',
    });
    expect(rowIssues(withId(cell('1.09874E+09')))[0]).toMatchObject({
      code: 'SCIENTIFIC_NOTATION',
      severity: 'error',
    });
  });

  it('drops the number warning once the user types the value', () => {
    const row = editRow(withId(cell('900123456', 'number')), {
      taxId: '0900123456',
    });
    expect(rowIssues(row)).toEqual([]);
  });

  it('needs an ID type and a country for an ID number', () => {
    expect(
      rowIssues(previewRow(2, { taxId: '123', country: '' }))
    ).toContainEqual({
      field: 'taxId',
      code: 'TAX_ID_INCOMPLETE',
      severity: 'error',
    });
  });
});

describe('in-file duplicates and buckets', () => {
  it('first row wins, and fixing row A clears row B', () => {
    const a = previewRow(2, { primaryContactEmail: 'same@x.co' });
    const b = previewRow(3, { primaryContactEmail: 'SAME@x.co' });
    const c = previewRow(4, { taxIdType: 'NIT', taxId: '900.123.456' });
    const d = previewRow(5, { taxIdType: 'NIT', taxId: '900123456' });

    expect(inFileDuplicates([a, b, c, d])).toEqual(new Set([3, 5]));

    const fixedA = editRow(a, { primaryContactEmail: 'other@x.co' });
    expect(inFileDuplicates([fixedA, b, c, d])).toEqual(new Set([5]));
  });

  it('ignores excluded and invalid rows', () => {
    const a = {
      ...previewRow(2, { primaryContactEmail: 'same@x.co' }),
      excluded: true,
    };
    const b = previewRow(3, { primaryContactEmail: 'same@x.co' });
    expect(inFileDuplicates([a, b]).size).toBe(0);
  });

  it('editing email, country, ID type, ID number or name clears the check; client type does not', () => {
    const row = previewRow(2);
    const checked: ImportPreviewRow = {
      ...row,
      check: {
        key: checkKey(row.values),
        result: { rowNumber: 2, status: 'would_create' },
      },
    };
    expect(rowBucket(checked, new Set())).toBe('will_create');

    for (const change of [
      { primaryContactEmail: 'new@x.co' },
      { country: 'PE' },
      { taxIdType: 'NIT' },
      { name: 'Renamed' },
    ]) {
      expect(rowBucket(editRow(checked, change), new Set())).toBe('checking');
    }
    expect(rowBucket(editRow(checked, { clientType: 'FARM' }), new Set())).toBe(
      'will_create'
    );
  });

  it('shows import results over the preview', () => {
    const row = previewRow(2);
    expect(rowBucket({ ...row, imported: 'not_confirmed' }, new Set())).toBe(
      'not_confirmed'
    );
    expect(
      rowBucket(
        {
          ...row,
          imported: { rowNumber: 2, status: 'skipped', reason: 'EMAIL_EXISTS' },
        },
        new Set()
      )
    ).toBe('already_in_lab');
    expect(
      rowBucket(
        {
          ...row,
          imported: {
            rowNumber: 2,
            status: 'conflict',
            reason: 'BATCH_ROW_MISMATCH',
          },
        },
        new Set()
      )
    ).toBe('failed');
  });

  it('sends empty optional values as undefined', () => {
    expect(toRequestRow(previewRow(2))).toEqual({
      rowNumber: 2,
      name: 'Clinic 2',
      clientType: 'VETERINARY_CLINIC',
      primaryContactEmail: 'clinic2@example.com',
      country: 'CO',
      primaryContactName: undefined,
      phone: undefined,
      address: undefined,
      city: undefined,
      legalName: undefined,
      taxIdType: undefined,
      taxId: undefined,
      notes: undefined,
    });
  });
});

describe('buildRetryCsv', () => {
  const headers = { ...en.clients.import.template };
  const options = {
    headers,
    clientTypeLabel: (code: string) =>
      (en.clients.type as Record<string, string>)[code] ?? code,
    statusLabel: (row: ImportPreviewRow) => `status ${row.rowNumber}`,
    reasonLabel: () => 'reason',
  };

  const created = {
    ...previewRow(2),
    imported: { rowNumber: 2, status: 'created', clientId: 'c1' } as const,
  };
  const corrected = editRow(
    {
      ...previewRow(3),
      imported: { rowNumber: 3, status: 'invalid', errors: [] } as const,
    },
    { name: 'Vet, "Norte"\nSede 2', phone: '+57 300 123 4567' }
  );
  const formulas = previewRow(4, {
    address: '=HYPERLINK("x")',
    city: '@SUM(1)',
    legalName: '-1',
  });
  const excluded = { ...previewRow(5), excluded: true };
  const notConfirmed = { ...previewRow(6), imported: 'not_confirmed' as const };

  const csv = buildRetryCsv(
    [created, corrected, formulas, excluded, notConfirmed],
    options
  );

  it('has a BOM, CRLF line ends, template headers plus Status and Reason', () => {
    expect(csv.startsWith('﻿"Name","Legal name"')).toBe(true);
    expect(csv.split('\r\n')[0]).toContain('"Notes","Status","Reason"');
  });

  it('contains every row except Created, with the corrected values', () => {
    const parsed = parseCsvText(csv);
    expect(parsed.rows.map((r) => r[12].text)).toEqual([
      'status 3',
      'status 4',
      'status 5',
      'status 6',
    ]);
    expect(parsed.rows[0][0].text).toBe('Vet, "Norte"\nSede 2');
  });

  it('escapes every value that starts with a formula character, phones included', () => {
    const parsed = parseCsvText(csv);
    expect(parsed.rows[0][4].text).toBe("'+57 300 123 4567");
    expect(parsed.rows[1][5].text).toBe(`'=HYPERLINK("x")`);
    expect(parsed.rows[1][6].text).toBe("'@SUM(1)");
    expect(parsed.rows[1][1].text).toBe("'-1");
  });

  it('round-trips: re-importing keeps the apostrophe, flags it, and removal gives the original', () => {
    const sheet = parseCsvText(csv);
    const mapping = guessMapping(sheet.headers, TEMPLATES);
    const rows = buildPreviewRows(sheet, mapping, OPTIONS);

    expect(rows[0].values.phone).toBe("'+57 300 123 4567");
    expect(rows[0].values.clientType).toBe('VETERINARY_CLINIC');
    expect(rowIssues(rows[0]).map((i) => i.code)).toContain(
      'APOSTROPHE_PREFIX'
    );
    expect(removeLeadingApostrophe(rows[0].values.phone)).toBe(
      '+57 300 123 4567'
    );
    expect(removeLeadingApostrophe(rows[1].values.address)).toBe(
      '=HYPERLINK("x")'
    );
  });
});

describe('runImportGroups', () => {
  const rows = (n: number): ImportRequestRow[] =>
    Array.from({ length: n }, (_, i) => ({
      rowNumber: i + 2,
      name: `C${i}`,
      clientType: 'VETERINARY_CLINIC',
      primaryContactEmail: `c${i}@x.co`,
    }));
  const created = (group: ImportRequestRow[]) => ({
    results: group.map((r) => ({
      rowNumber: r.rowNumber,
      status: 'created' as const,
      clientId: `id-${r.rowNumber}`,
    })),
  });
  const sleep = vi.fn(async () => undefined);

  it('retries a failed group with the same rows', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Gateway Timeout'), { status: 504 })
      )
      .mockImplementation(async (g: ImportRequestRow[]) => created(g));

    const outcome = await runImportGroups({
      rows: rows(30),
      send,
      groupSize: 25,
      sleep,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    expect(outcome.results).toHaveLength(30);
    expect(outcome.notConfirmed).toEqual([]);
  });

  it('stops after the retries run out and returns the rest as not confirmed', async () => {
    const onGroup = vi.fn();
    const send = vi
      .fn()
      .mockImplementationOnce(async (g: ImportRequestRow[]) => created(g))
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await runImportGroups({
      rows: rows(60),
      send,
      groupSize: 25,
      sleep,
      onGroup,
    });

    expect(send).toHaveBeenCalledTimes(1 + 3); // first group, then 1 try + 2 retries
    expect(outcome.results).toHaveLength(25);
    expect(outcome.notConfirmed.map((r) => r.rowNumber)).toEqual(
      rows(60)
        .slice(25)
        .map((r) => r.rowNumber)
    );
    expect(onGroup).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 4xx', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Bad Request'), { status: 400 })
      );

    const outcome = await runImportGroups({ rows: rows(5), send, sleep });

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome.notConfirmed).toHaveLength(5);
  });

  it('builds results only from responses', async () => {
    const send = vi.fn(async (g: ImportRequestRow[]) => ({
      results: g.map((r) => ({
        rowNumber: r.rowNumber,
        status: 'skipped' as const,
        reason: 'EMAIL_EXISTS' as const,
      })),
    }));

    const outcome = await runImportGroups({ rows: rows(3), send, sleep });

    expect(outcome.results.every((r) => r.status === 'skipped')).toBe(true);
  });
});
