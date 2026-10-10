// ISO 3166-1 alpha-2 codes clinics can pick — keep in sync with
// apps/frontend/src/app/core/data/countries.ts (the clinic app stores the same
// codes in Tenant.country). Display names come from Intl, so no i18n keys.
export const COUNTRY_CODES = [
  'AR',
  'AU',
  'BR',
  'CA',
  'CL',
  'CO',
  'DE',
  'EC',
  'ES',
  'FR',
  'GB',
  'GT',
  'HN',
  'IT',
  'MX',
  'NI',
  'PA',
  'PE',
  'PT',
  'SV',
  'US',
  'UY',
  'VE',
] as const;

export function countryName(code: string, language: string): string {
  try {
    return (
      new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}
