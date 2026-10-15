import { Prisma } from '@prisma/client';

// A type alias (not an interface) so it satisfies Prisma's JSON input type
export type LabPhoneSnapshot = {
  label: string;
  number: string;
  /** Reachable on WhatsApp; only present when true */
  whatsapp?: true;
};

/**
 * Codes the old Lab Settings dropdown stored as `label` (before labels were
 * free text). Still found in saved phone lists and release snapshots.
 * Spanish, like the rest of the PDF.
 */
const LEGACY_PHONE_LABELS: Record<string, string> = {
  commercial: 'Comercial',
  personal: 'Personal',
  other: 'Otro',
};

/** WhatsApp flag, or the old dropdown's "whatsapp" label. */
export function isWhatsAppPhone(entry: {
  label?: unknown;
  whatsapp?: unknown;
}): boolean {
  return entry.whatsapp === true || entry.label === 'whatsapp';
}

/** The label already says WhatsApp ("WhatsApp", "whatsapp resultados"). */
export function mentionsWhatsApp(label: string): boolean {
  return /\bwhats\s?app\b/i.test(label);
}

/**
 * Label shown in the PDF footer: the lab's own text, old codes translated,
 * and "WhatsApp" for WhatsApp numbers ("Recepción (WhatsApp)", "WhatsApp") —
 * never twice when the label already says it.
 */
export function phoneLabelForPdf(entry: {
  label?: unknown;
  whatsapp?: unknown;
}): string {
  const raw = typeof entry.label === 'string' ? entry.label.trim() : '';
  const text = raw === 'whatsapp' ? '' : LEGACY_PHONE_LABELS[raw] ?? raw;
  if (!isWhatsAppPhone(entry) || mentionsWhatsApp(text)) return text;
  return text ? `${text} (WhatsApp)` : 'WhatsApp';
}

/**
 * Phone list frozen on a release for the PDF footer. Lab Settings edits the
 * labelled `phoneNumbers` list; older labs may only have the single `phone`
 * column, which is kept as an unlabelled entry.
 */
export function labPhoneNumbersSnapshot(
  phoneNumbers: Prisma.JsonValue | null | undefined,
  phone: string | null | undefined
): LabPhoneSnapshot[] | typeof Prisma.DbNull {
  const list = Array.isArray(phoneNumbers)
    ? phoneNumbers
        .map((p) => {
          const entry = (p ?? {}) as Record<string, unknown>;
          return {
            label: typeof entry.label === 'string' ? entry.label.trim() : '',
            number: typeof entry.number === 'string' ? entry.number.trim() : '',
            ...(entry.whatsapp === true && { whatsapp: true as const }),
          };
        })
        .filter((p) => p.number)
    : [];
  if (list.length > 0) return list;
  if (phone?.trim()) return [{ label: '', number: phone.trim() }];
  return Prisma.DbNull;
}
