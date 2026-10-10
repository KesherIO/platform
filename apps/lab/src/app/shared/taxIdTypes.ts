// Tax / identification document types per country, for a clinic's tax ID.
// KEEP IN SYNC with libs/shared-types/src/lib/tax-id-type.model.ts (the lab
// app doesn't import @vet-ai/shared-types). The API rejects a type that isn't
// listed for the client's country, except 'OTHER'.
// Display labels: clients.tax_id_types.<CODE> in the i18n files.

export const TAX_ID_TYPES_BY_COUNTRY: Readonly<
  Record<string, readonly string[]>
> = {
  CO: ['NIT', 'CC', 'CE', 'PP'],
  CL: ['RUT'],
  AR: ['CUIT', 'CUIL', 'DNI'],
  PE: ['RUC', 'DNI', 'CE'],
  EC: ['RUC', 'CI'],
  BR: ['CNPJ', 'CPF'],
  MX: ['RFC'],
};

export const OTHER_TAX_ID_TYPE = 'OTHER';

/** Every code that has a label. */
export const ALL_TAX_ID_TYPES = [
  ...new Set([...Object.values(TAX_ID_TYPES_BY_COUNTRY).flat(), 'OTHER']),
];

/** Types offered for a country: its own list plus 'OTHER'. */
export function taxIdTypesForCountry(
  country: string | null | undefined
): string[] {
  return [
    ...((country && TAX_ID_TYPES_BY_COUNTRY[country]) ?? []),
    OTHER_TAX_ID_TYPE,
  ];
}

export function isTaxIdTypeForCountry(
  taxIdType: string,
  country: string | null | undefined
): boolean {
  return taxIdTypesForCountry(country).includes(taxIdType);
}

/**
 * How labs write ID types in their files (normalized: uppercase, no accents
 * or punctuation) → candidate codes, first match valid for the country wins.
 * "CEDULA" is CC in Colombia and CI in Ecuador.
 */
const TAX_ID_TYPE_ALIASES: Record<string, string[]> = {
  CEDULA: ['CC', 'CI'],
  'CEDULA DE CIUDADANIA': ['CC'],
  'CEDULA DE IDENTIDAD': ['CI'],
  'CEDULA DE EXTRANJERIA': ['CE'],
  'CARNE DE EXTRANJERIA': ['CE'],
  PASAPORTE: ['PP'],
  PASSPORT: ['PP'],
  OTRO: ['OTHER'],
  OUTRO: ['OTHER'],
};

const normalizeTypeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/**
 * Maps a value from a file ("NIT", "Cédula", "c.c.") to a type code valid for
 * the country. Returns null when nothing fits, so the row needs a fix.
 */
export function matchTaxIdType(
  value: string,
  country: string | null | undefined
): string | null {
  const text = normalizeTypeText(value);
  if (!text) return null;
  const compact = text.replace(/ /g, '');
  const candidates = [
    ...(TAX_ID_TYPE_ALIASES[text] ?? []),
    ...ALL_TAX_ID_TYPES.filter((code) => code === compact),
  ];
  return candidates.find((c) => isTaxIdTypeForCountry(c, country)) ?? null;
}

/** '' when the ID type isn't offered for the (new) country. */
export function clearInvalidTaxIdType(
  country: string,
  taxIdType: string
): string {
  return taxIdType && !isTaxIdTypeForCountry(taxIdType, country || null)
    ? ''
    : taxIdType;
}
