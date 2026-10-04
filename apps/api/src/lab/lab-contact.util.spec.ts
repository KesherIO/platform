import { Prisma } from '@prisma/client';
import { labPhoneNumbersSnapshot } from './lab-contact.util';

describe('labPhoneNumbersSnapshot', () => {
  it('keeps labelled phones from Lab Settings, trimmed', () => {
    expect(
      labPhoneNumbersSnapshot(
        [
          { label: ' WhatsApp ', number: ' +57 300 123 4567 ' },
          { label: 'Fijo', number: '+57 601 234 5678' },
        ],
        '+57 601 000 0000'
      )
    ).toEqual([
      { label: 'WhatsApp', number: '+57 300 123 4567' },
      { label: 'Fijo', number: '+57 601 234 5678' },
    ]);
  });

  it('drops entries without a number', () => {
    expect(
      labPhoneNumbersSnapshot(
        [
          { label: 'WhatsApp', number: '' },
          { label: 'Fijo', number: '+57 601 234 5678' },
        ],
        null
      )
    ).toEqual([{ label: 'Fijo', number: '+57 601 234 5678' }]);
  });

  it('falls back to the single phone column as an unlabelled entry', () => {
    expect(labPhoneNumbersSnapshot([], '+57 601 234 5678')).toEqual([
      { label: '', number: '+57 601 234 5678' },
    ]);
  });

  it('stores database NULL when the lab has no phones', () => {
    expect(labPhoneNumbersSnapshot(null, null)).toBe(Prisma.DbNull);
  });
});
