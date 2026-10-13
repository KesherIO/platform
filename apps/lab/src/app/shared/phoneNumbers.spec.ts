import {
  mentionsWhatsApp,
  normalizeLabPhones,
  toSavedPhones,
  updatePhoneRow,
} from './phoneNumbers';
import type { LabPhoneNumber } from '../types/lab.types';

const row = (
  label: string,
  whatsapp = false,
  number = '1'
): LabPhoneNumber => ({ label, number, whatsapp });

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

describe('only one WhatsApp number', () => {
  it('keeps the first WhatsApp number from older saves', () => {
    expect(
      normalizeLabPhones(
        [
          { label: 'Recepción', number: '1', whatsapp: true },
          { label: 'whatsapp', number: '2' },
        ],
        legacy
      ).map((p) => p.whatsapp)
    ).toEqual([true, false]);
  });

  it('checking WhatsApp on one number unchecks the others', () => {
    const phones = [row('Recepción', true), row('Urgencias')];
    expect(
      updatePhoneRow(phones, 1, { whatsapp: true }).map((p) => p.whatsapp)
    ).toEqual([false, true]);
  });

  it('unchecking leaves no WhatsApp number', () => {
    const phones = [row('Recepción', true), row('Urgencias')];
    expect(
      updatePhoneRow(phones, 0, { whatsapp: false }).map((p) => p.whatsapp)
    ).toEqual([false, false]);
  });

  it('typing a WhatsApp label checks the box when no number is WhatsApp yet', () => {
    expect(updatePhoneRow([row('')], 0, { label: 'WhatsApp' })[0]).toEqual(
      row('WhatsApp', true)
    );
  });

  it("typing a WhatsApp label doesn't move the WhatsApp number", () => {
    const phones = [row('Recepción', true), row('')];
    expect(
      updatePhoneRow(phones, 1, { label: 'WhatsApp 2' }).map((p) => p.whatsapp)
    ).toEqual([true, false]);
  });

  it('never saves more than one', () => {
    expect(
      toSavedPhones([row('A', true), row('B', true)]).filter(
        (p) => 'whatsapp' in p
      )
    ).toHaveLength(1);
  });
});

describe('mentionsWhatsApp', () => {
  it.each([
    ['WhatsApp', true],
    ['whatsapp resultados', true],
    ['Whats App', true],
    ['Recepción', false],
    ['', false],
  ])('%j → %s', (label, expected) => {
    expect(mentionsWhatsApp(label)).toBe(expected);
  });
});
