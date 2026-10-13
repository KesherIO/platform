import type { LabPhoneNumber } from '../types/lab.types';

/**
 * Codes the old Lab Settings dropdown saved as `label`, before labels became
 * free text with a separate WhatsApp checkbox.
 */
const LEGACY_LABELS = ['commercial', 'personal', 'other'] as const;

/**
 * Phone list from the API, in the form's shape: "whatsapp" becomes the
 * checkbox, old codes become their translated text (saved as such on the
 * next save). No data migration — this runs on every load.
 */
export function normalizeLabPhones(
  raw: unknown,
  legacyLabel: (code: (typeof LEGACY_LABELS)[number]) => string
): LabPhoneNumber[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const entry = (p ?? {}) as Record<string, unknown>;
    const label = typeof entry.label === 'string' ? entry.label : '';
    const number = typeof entry.number === 'string' ? entry.number : '';
    const whatsapp = entry.whatsapp === true || label === 'whatsapp';
    const legacy = LEGACY_LABELS.find((code) => code === label);
    return {
      label: label === 'whatsapp' ? '' : legacy ? legacyLabel(legacy) : label,
      number,
      whatsapp,
    };
  });
}

/** What the API stores: trimmed, `whatsapp` only when true. */
export function toSavedPhones(phones: LabPhoneNumber[]) {
  return phones.map(({ label, number, whatsapp }) => ({
    label: label.trim(),
    number: number.trim(),
    ...(whatsapp && { whatsapp: true }),
  }));
}
