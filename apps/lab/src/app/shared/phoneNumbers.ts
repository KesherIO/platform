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

/** ITU calling codes for the countries in `COUNTRY_CODES`. */
const CALLING_CODES: Record<string, string> = {
  AR: '54',
  AU: '61',
  BR: '55',
  CA: '1',
  CL: '56',
  CO: '57',
  DE: '49',
  EC: '593',
  ES: '34',
  FR: '33',
  GB: '44',
  GT: '502',
  HN: '504',
  IT: '39',
  MX: '52',
  NI: '505',
  PA: '507',
  PE: '51',
  PT: '351',
  SV: '503',
  US: '1',
  UY: '598',
  VE: '58',
};

/**
 * Digits a national number must have for us to be sure which country code to
 * add. Countries not listed are never given a code — only formatted when the
 * number already carries a "+".
 */
const NATIONAL_LENGTHS: Record<string, number[]> = {
  AR: [10],
  CA: [10],
  CL: [9],
  CO: [10],
  EC: [9],
  ES: [9],
  FR: [9],
  GT: [8],
  HN: [8],
  MX: [10],
  NI: [8],
  PE: [9],
  PT: [9],
  SV: [8],
  US: [10],
  UY: [8],
  VE: [10],
};

const GROUPINGS: Record<number, number[]> = {
  7: [3, 4],
  8: [4, 4],
  9: [3, 3, 3],
  10: [3, 3, 4],
  11: [3, 4, 4],
};

function groupDigits(digits: string): string | null {
  const groups = GROUPINGS[digits.length];
  if (!groups) return null;
  let at = 0;
  return groups.map((size) => digits.slice(at, (at += size))).join(' ');
}

// Longest first, so "593" is tried before "59…" lookalikes and "1" last.
const CODES_LONGEST_FIRST = [...new Set(Object.values(CALLING_CODES))].sort(
  (a, b) => b.length - a.length
);

/**
 * Display form of a stored phone number, e.g. "+57 302 433 0161". The country
 * code is only added when `country` is known and the number has the national
 * length for it; anything we can't read confidently comes back as typed.
 * Never use the result as the stored value.
 */
export function formatPhoneDisplay(
  raw: string | null | undefined,
  country?: string | null
): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  // Letters or extensions ("x12", "ext") — not ours to reformat.
  if (/[a-z]/i.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  const isInternational = trimmed.startsWith('+') || digits.startsWith('00');
  const iso = country?.toUpperCase();
  const ownCode = iso ? CALLING_CODES[iso] : undefined;

  if (isInternational) {
    const full = trimmed.startsWith('+') ? digits : digits.slice(2);
    if (full.length < 8 || full.length > 15) return trimmed;
    const code =
      ownCode && full.startsWith(ownCode)
        ? ownCode
        : CODES_LONGEST_FIRST.find((c) => full.startsWith(c));
    if (!code) return trimmed;
    const grouped = groupDigits(full.slice(code.length));
    return grouped ? `+${code} ${grouped}` : trimmed;
  }

  if (!iso || !ownCode || !NATIONAL_LENGTHS[iso]?.includes(digits.length)) {
    return trimmed;
  }
  const grouped = groupDigits(digits);
  return grouped ? `+${ownCode} ${grouped}` : trimmed;
}
