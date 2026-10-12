import { taxIdTypesForCountry } from '@vet-ai/shared-types';

/**
 * ID type options for a clinic's country — its own types plus 'OTHER'.
 * Labels are TAX_ID_TYPES.<type> i18n keys in en.json / es.json.
 */
export function taxIdTypeOptions(
  country: string | null | undefined
): { label: string; value: string }[] {
  return taxIdTypesForCountry(country || null).map((type) => ({
    label: `TAX_ID_TYPES.${type}`,
    value: type,
  }));
}

/** The ID type to keep after a country change: '' when it no longer fits. */
export function taxIdTypeForCountry(
  taxIdType: string | null | undefined,
  country: string | null | undefined
): string {
  return taxIdType && taxIdTypesForCountry(country || null).includes(taxIdType)
    ? taxIdType
    : '';
}

/**
 * The API only accepts an ID number with a country and an ID type, so the
 * duplicate check has the full key (see tenants/clinic-profile.util.ts).
 */
export function isTaxIdIncomplete(
  country: string | null | undefined,
  taxIdType: string | null | undefined,
  taxId: string | null | undefined
): boolean {
  return !!taxId?.trim() && (!country?.trim() || !taxIdType?.trim());
}
