import { Prisma } from '@prisma/client';
import {
  isWhatsAppPhone,
  labPhoneNumbersSnapshot,
  phoneLabelForPdf,
} from './lab-contact.util';

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

  it('keeps the WhatsApp flag only when true', () => {
    expect(
      labPhoneNumbersSnapshot(
        [
          { label: 'Recepción', number: '+57 300 123 4567', whatsapp: true },
          { label: 'Urgencias', number: '+57 601 234 5678', whatsapp: false },
        ],
        null
      )
    ).toEqual([
      { label: 'Recepción', number: '+57 300 123 4567', whatsapp: true },
      { label: 'Urgencias', number: '+57 601 234 5678' },
    ]);
  });
});

describe('isWhatsAppPhone', () => {
  it.each([
    [{ label: 'Recepción', whatsapp: true }, true],
    [{ label: 'whatsapp' }, true],
    [{ label: 'Recepción' }, false],
    [{ label: 'WhatsApp' }, false],
  ])('%j → %s', (entry, expected) => {
    expect(isWhatsAppPhone(entry)).toBe(expected);
  });
});

describe('phoneLabelForPdf', () => {
  it.each([
    [{ label: 'Recepción' }, 'Recepción'],
    [{ label: ' Recepción ', whatsapp: true }, 'Recepción (WhatsApp)'],
    [{ label: '', whatsapp: true }, 'WhatsApp'],
    [{ label: 'whatsapp' }, 'WhatsApp'],
    [{ label: 'commercial' }, 'Comercial'],
    [{ label: 'personal' }, 'Personal'],
    [{ label: 'other' }, 'Otro'],
    [{ label: 'other', whatsapp: true }, 'Otro (WhatsApp)'],
    [{ label: 'WhatsApp', whatsapp: true }, 'WhatsApp'],
    [{ label: 'whatsapp resultados', whatsapp: true }, 'whatsapp resultados'],
    [{ label: '' }, ''],
    [{}, ''],
  ])('%j → %j', (entry, expected) => {
    expect(phoneLabelForPdf(entry)).toBe(expected);
  });
});
