import { BadRequestException } from '@nestjs/common';
import { buildClinicProfileUpdate } from './clinic-profile.util';

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
});
