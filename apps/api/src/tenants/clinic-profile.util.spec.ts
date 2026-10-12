import { BadRequestException } from '@nestjs/common';
import {
  assertValidTaxIdentity,
  buildClinicProfileUpdate,
  checkTaxIdentity,
  normalizeTaxId,
  touchesTaxIdentity,
} from './clinic-profile.util';

describe('buildClinicProfileUpdate', () => {
  it('omits fields that were not provided', () => {
    expect(buildClinicProfileUpdate({ city: 'Cali' })).toEqual({
      city: 'Cali',
    });
  });

  it('clears optional fields sent as null, empty or whitespace', () => {
    expect(
      buildClinicProfileUpdate({
        phone: null,
        address: '',
        primaryContactName: '   ',
      })
    ).toEqual({ phone: null, address: null, primaryContactName: null });
  });

  it('trims values', () => {
    expect(buildClinicProfileUpdate({ name: '  City Vet  ' })).toEqual({
      name: 'City Vet',
    });
  });

  it.each(['name', 'email'] as const)(
    'refuses to clear the required field %s',
    (field) => {
      expect(() => buildClinicProfileUpdate({ [field]: '' })).toThrow(
        BadRequestException
      );
      expect(() => buildClinicProfileUpdate({ [field]: null })).toThrow(
        BadRequestException
      );
    }
  );

  it('derives taxIdNormalized from taxId and clears it with taxId', () => {
    expect(buildClinicProfileUpdate({ taxId: ' 900.123.456-7 ' })).toEqual({
      taxId: '900.123.456-7',
      taxIdNormalized: '9001234567',
    });
    expect(buildClinicProfileUpdate({ taxId: '' })).toEqual({
      taxId: null,
      taxIdNormalized: null,
    });
    expect(buildClinicProfileUpdate({ city: 'Cali' })).not.toHaveProperty(
      'taxIdNormalized'
    );
  });

  it('never accepts taxIdNormalized from the caller', () => {
    expect(
      buildClinicProfileUpdate({ taxIdNormalized: 'FORGED' } as never)
    ).toEqual({});
  });
});

describe('normalizeTaxId', () => {
  it.each([
    ['12.345.678-k', '12345678K'],
    ['900.123.456-7', '9001234567'],
    ['0012345', '0012345'],
    ['1 0 9 8 7', '10987'],
    ['20-12345678/9', '20123456789'],
  ])('%s → %s', (raw, normalized) => {
    expect(normalizeTaxId(raw)).toBe(normalized);
  });

  it('returns null when only separators are left', () => {
    expect(normalizeTaxId(' .-/ ')).toBeNull();
  });
});

describe('checkTaxIdentity', () => {
  it('accepts a type of the country, or OTHER anywhere', () => {
    expect(
      checkTaxIdentity({ country: 'CL', taxIdType: 'RUT', taxId: '1-9' })
    ).toEqual([]);
    expect(
      checkTaxIdentity({ country: 'UY', taxIdType: 'OTHER', taxId: '1' })
    ).toEqual([]);
  });

  it('accepts no tax ID at all (optional everywhere)', () => {
    expect(checkTaxIdentity({ country: 'CO' })).toEqual([]);
  });

  it('requires a type and a country for a number', () => {
    expect(checkTaxIdentity({ country: 'CO', taxId: '900123456' })).toEqual([
      { field: 'taxId', code: 'TAX_ID_INCOMPLETE' },
    ]);
  });
});

describe('assertValidTaxIdentity', () => {
  const STORED = { country: 'CO', taxIdType: 'NIT', taxId: '900.123.456-7' };

  it('keeps stored values for fields the update omits', () => {
    expect(() =>
      assertValidTaxIdentity({ taxId: '800' }, STORED)
    ).not.toThrow();
  });

  it('rejects a country change the stored ID type does not fit', () => {
    expect(() => assertValidTaxIdentity({ country: 'CL' }, STORED)).toThrow(
      BadRequestException
    );
  });

  it('accepts a country change together with a type of that country', () => {
    expect(() =>
      assertValidTaxIdentity({ country: 'CL', taxIdType: 'RUT' }, STORED)
    ).not.toThrow();
  });

  it('rejects clearing the type while a number stays on record', () => {
    expect(() => assertValidTaxIdentity({ taxIdType: null }, STORED)).toThrow(
      'Invalid tax ID: taxId TAX_ID_INCOMPLETE.'
    );
  });

  it('accepts clearing the type and the number together', () => {
    expect(() =>
      assertValidTaxIdentity({ taxIdType: null, taxId: null }, STORED)
    ).not.toThrow();
  });

  it('checks the update alone when nothing is stored', () => {
    expect(() => assertValidTaxIdentity({ taxId: '900123456' })).toThrow(
      BadRequestException
    );
  });
});

describe('touchesTaxIdentity', () => {
  it('is true only when country, type or number is in the update', () => {
    expect(touchesTaxIdentity({ country: '' })).toBe(true);
    expect(touchesTaxIdentity({ taxId: null })).toBe(true);
    expect(touchesTaxIdentity({})).toBe(false);
  });
});
