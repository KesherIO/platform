import type { LabPhoneNumber } from '../types/lab.types';

/**
 * Codes the old Lab Settings dropdown saved as `label`, before labels became
 * free text with a separate WhatsApp checkbox.
 */
const LEGACY_LABELS = ['commercial', 'personal', 'other'] as const;

/** "WhatsApp", "whatsapp resultados", "Whats App" — the label already says it. */
export function mentionsWhatsApp(label: string): boolean {
  return /\bwhats\s?app\b/i.test(label);
}

/** Only one number is WhatsApp: the clinic app has one "Chat on WhatsApp" button. */
function keepFirstWhatsApp(phones: LabPhoneNumber[]): LabPhoneNumber[] {
  const first = phones.findIndex((p) => p.whatsapp);
  return phones.map((p, i) =>
    p.whatsapp && i !== first ? { ...p, whatsapp: false } : p
  );
}

/**
 * One edit to one row. Checking WhatsApp unchecks it everywhere else; typing
 * a label that says WhatsApp checks it, when no number is WhatsApp yet.
 */
export function updatePhoneRow(
  phones: LabPhoneNumber[],
  index: number,
  patch: Partial<LabPhoneNumber>
): LabPhoneNumber[] {
  const next = phones.map((p, i) => (i === index ? { ...p, ...patch } : p));
  if (patch.whatsapp === true) {
    return next.map((p, i) => (i === index ? p : { ...p, whatsapp: false }));
  }
  if (
    patch.label !== undefined &&
    mentionsWhatsApp(patch.label) &&
    !phones.some((p) => p.whatsapp)
  ) {
    return next.map((p, i) => (i === index ? { ...p, whatsapp: true } : p));
  }
  return next;
}

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
  const phones = raw.map((p) => {
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
  // Older saves may mark several; the clinic app always used the first.
  return keepFirstWhatsApp(phones);
}

/** What the API stores: trimmed, `whatsapp` only when true, on one number. */
export function toSavedPhones(phones: LabPhoneNumber[]) {
  return keepFirstWhatsApp(phones).map(({ label, number, whatsapp }) => ({
    label: label.trim(),
    number: number.trim(),
    ...(whatsapp && { whatsapp: true }),
  }));
}
