/**
 * Tax / identification document types per country, for a clinic's tax ID.
 *
 * KEEP IN SYNC with the lab portal's own copy in
 * apps/lab/src/app/shared/taxIdTypes.ts (the lab app doesn't import
 * @vet-ai/shared-types).
 *
 * 'OTHER' is accepted for any country.
 */
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

/** Types offered for a country: its own list plus 'OTHER'. */
export function taxIdTypesForCountry(country: string | null | undefined) {
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
