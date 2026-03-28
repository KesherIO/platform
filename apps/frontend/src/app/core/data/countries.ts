/**
 * ISO 3166-1 alpha-2 country list.
 *
 * Keys are i18n translation keys; values are ISO codes stored in the DB.
 * Display name is resolved at runtime via the TranslatePipe using
 * COUNTRIES.<code> keys in en.json / es.json.
 *
 * To add more countries: add the entry here AND the translation keys.
 */
export interface Country {
  /** ISO 3166-1 alpha-2 code — stored in Tenant.country */
  value: string;
  /** i18n translation key for the display name */
  label: string;
}

export const COUNTRIES: Country[] = [
  { value: 'AR', label: 'COUNTRIES.AR' },
  { value: 'AU', label: 'COUNTRIES.AU' },
  { value: 'BR', label: 'COUNTRIES.BR' },
  { value: 'CA', label: 'COUNTRIES.CA' },
  { value: 'CL', label: 'COUNTRIES.CL' },
  { value: 'CO', label: 'COUNTRIES.CO' },
  { value: 'DE', label: 'COUNTRIES.DE' },
  { value: 'ES', label: 'COUNTRIES.ES' },
  { value: 'FR', label: 'COUNTRIES.FR' },
  { value: 'GB', label: 'COUNTRIES.GB' },
  { value: 'GT', label: 'COUNTRIES.GT' },
  { value: 'HN', label: 'COUNTRIES.HN' },
  { value: 'IT', label: 'COUNTRIES.IT' },
  { value: 'MX', label: 'COUNTRIES.MX' },
  { value: 'NI', label: 'COUNTRIES.NI' },
  { value: 'PA', label: 'COUNTRIES.PA' },
  { value: 'PE', label: 'COUNTRIES.PE' },
  { value: 'PT', label: 'COUNTRIES.PT' },
  { value: 'SV', label: 'COUNTRIES.SV' },
  { value: 'US', label: 'COUNTRIES.US' },
  { value: 'UY', label: 'COUNTRIES.UY' },
  { value: 'VE', label: 'COUNTRIES.VE' },
];