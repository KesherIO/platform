import { resolvePickupLocation } from './pickup-location.util';

const CLINIC = {
  address: 'Calle 1 #2-3',
  city: 'Bogotá',
  phone: '+57 300 000 0000',
  primaryContactName: 'Dra. Ana',
};

describe('resolvePickupLocation', () => {
  it('uses the lab collection settings when fully populated', () => {
    const r = resolvePickupLocation(
      {
        pickupAddress: 'Lab-set address',
        pickupContactName: 'Recepción',
        pickupContactPhone: '111',
        pickupInstructions: 'Timbre 2',
      },
      CLINIC
    );
    expect(r).toEqual({
      pickupAddress: 'Lab-set address',
      pickupContactName: 'Recepción',
      pickupContactPhone: '111',
      pickupInstructions: 'Timbre 2',
      isAlternateLocation: false,
      pickupLocationNotes: null,
    });
  });

  it('falls back field by field, appending the city to the address', () => {
    const r = resolvePickupLocation(
      {
        pickupAddress: null,
        pickupContactName: 'Recepción',
        pickupContactPhone: '  ',
        pickupInstructions: null,
      },
      CLINIC
    );
    expect(r.pickupAddress).toBe('Calle 1 #2-3, Bogotá');
    expect(r.pickupContactName).toBe('Recepción');
    expect(r.pickupContactPhone).toBe('+57 300 000 0000');
  });

  it('returns nulls when neither source has data', () => {
    const r = resolvePickupLocation(null, null);
    expect(r.pickupAddress).toBeNull();
    expect(r.pickupContactName).toBeNull();
    expect(r.pickupContactPhone).toBeNull();
  });

  it('uses the alternate location over settings and the clinic profile', () => {
    const r = resolvePickupLocation(
      {
        pickupAddress: 'Lab-set address',
        pickupContactName: 'Recepción',
        pickupContactPhone: '111',
        pickupInstructions: 'Keep cold',
      },
      CLINIC,
      {
        address: ' Finca La Esperanza ',
        contactName: 'Juan',
        contactPhone: '222',
        notes: ' Portón verde ',
      }
    );
    expect(r).toEqual({
      pickupAddress: 'Finca La Esperanza',
      pickupContactName: 'Juan',
      pickupContactPhone: '222',
      pickupInstructions: 'Keep cold',
      isAlternateLocation: true,
      pickupLocationNotes: 'Portón verde',
    });
  });
});
