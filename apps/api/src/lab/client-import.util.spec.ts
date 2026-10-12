import {
  clientTaxKey,
  hashImportRow,
  toNewClinicInput,
  validateImportRow,
} from './client-import.util';

const VALID_ROW = {
  rowNumber: 2,
  name: 'City Vet',
  clientType: 'VETERINARY_CLINIC',
  primaryContactEmail: 'info@cityvet.com',
  country: 'CO',
};

describe('validateImportRow', () => {
  it('accepts a valid row and trims values', async () => {
    const result = await validateImportRow({
      ...VALID_ROW,
      name: '  City Vet ',
      primaryContactEmail: ' info@cityvet.com ',
      city: '',
    });

    expect(result).toEqual({
      ok: true,
      rowNumber: 2,
      input: expect.objectContaining({
        name: 'City Vet',
        email: 'info@cityvet.com',
        city: undefined,
      }),
    });
  });

  it.each([
    [{ name: '   ' }, 'name', 'REQUIRED'],
    [{ primaryContactEmail: undefined }, 'primaryContactEmail', 'REQUIRED'],
    [{ primaryContactEmail: 'nope' }, 'primaryContactEmail', 'INVALID_EMAIL'],
    [{ name: 'x'.repeat(201) }, 'name', 'TOO_LONG'],
    [{ country: 'co' }, 'country', 'INVALID_COUNTRY'],
    [{ clientType: 'HOSPITAL' }, 'clientType', 'INVALID_CLIENT_TYPE'],
    [{ taxIdType: 'RUT' }, 'taxIdType', 'INVALID_TAX_ID_TYPE'],
    [{ taxIdType: 'NIT', taxId: '---' }, 'taxId', 'INVALID_TAX_ID'],
    [
      { country: '', taxIdType: 'OTHER', taxId: '123' },
      'taxId',
      'TAX_ID_INCOMPLETE',
    ],
    [{ isAdmin: true }, 'isAdmin', 'UNKNOWN_FIELD'],
  ])('%j → %s %s', async (overrides, field, code) => {
    const result = await validateImportRow({ ...VALID_ROW, ...overrides });

    expect(result).toEqual({
      ok: false,
      rowNumber: 2,
      errors: [{ field, code }],
    });
  });
});

describe('clientTaxKey', () => {
  it('compares country + type + normalized number', () => {
    expect(
      clientTaxKey({ country: 'CL', taxIdType: 'RUT', taxId: '12.345.678-k' })
    ).toEqual({
      country: 'CL',
      taxIdType: 'RUT',
      taxIdNormalized: '12345678K',
    });
  });

  it('is null when any part is missing', () => {
    expect(clientTaxKey({ country: 'CO', taxId: '900123456' })).toBeNull();
  });
});

describe('hashImportRow', () => {
  const input = toNewClinicInput({
    ...VALID_ROW,
    taxIdType: 'NIT',
    taxId: '900.123.456-7',
  });

  it('ignores email letter case and tax ID punctuation', () => {
    expect(
      hashImportRow({
        ...input,
        email: 'INFO@cityvet.com',
        taxId: '9001234567',
      })
    ).toBe(hashImportRow(input));
  });

  it('changes when any submitted value changes', () => {
    expect(hashImportRow({ ...input, city: 'Cali' })).not.toBe(
      hashImportRow(input)
    );
    expect(hashImportRow({ ...input, notes: 'x' })).not.toBe(
      hashImportRow(input)
    );
  });
});
