import { normalizeLabPhones, toSavedPhones } from './phoneNumbers';

const legacy = (code: string) =>
  ({ commercial: 'Comercial', personal: 'Personal', other: 'Otro' }[code] ??
  code);

describe('normalizeLabPhones', () => {
  it('turns the old "whatsapp" label into the checkbox', () => {
    expect(
      normalizeLabPhones(
        [{ label: 'whatsapp', number: '+57 300 111 2222' }],
        legacy
      )
    ).toEqual([{ label: '', number: '+57 300 111 2222', whatsapp: true }]);
  });

  it('translates the old dropdown codes into editable text', () => {
    expect(
      normalizeLabPhones(
        [
          { label: 'commercial', number: '1' },
          { label: 'personal', number: '2' },
          { label: 'other', number: '3' },
        ],
        legacy
      ).map((p) => p.label)
    ).toEqual(['Comercial', 'Personal', 'Otro']);
  });

  it('keeps free-text labels and the WhatsApp flag as saved', () => {
    expect(
      normalizeLabPhones(
        [
          { label: 'Recepción', number: '1', whatsapp: true },
          { label: 'Urgencias', number: '2' },
        ],
        legacy
      )
    ).toEqual([
      { label: 'Recepción', number: '1', whatsapp: true },
      { label: 'Urgencias', number: '2', whatsapp: false },
    ]);
  });

  it('returns an empty list for anything but an array', () => {
    expect(normalizeLabPhones(null, legacy)).toEqual([]);
    expect(normalizeLabPhones({}, legacy)).toEqual([]);
  });
});

describe('toSavedPhones', () => {
  it('trims and sends whatsapp only when checked', () => {
    expect(
      toSavedPhones([
        { label: ' Recepción ', number: ' +57 300 ', whatsapp: true },
        { label: 'Urgencias', number: '2', whatsapp: false },
      ])
    ).toEqual([
      { label: 'Recepción', number: '+57 300', whatsapp: true },
      { label: 'Urgencias', number: '2' },
    ]);
  });
});
