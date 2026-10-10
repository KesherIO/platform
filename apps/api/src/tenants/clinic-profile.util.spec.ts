import { BadRequestException } from '@nestjs/common';
import {
  buildClinicProfileUpdate,
  normalizeTaxId,
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
