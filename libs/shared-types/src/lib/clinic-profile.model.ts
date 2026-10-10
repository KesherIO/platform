/**
 * Shared clinic profile — the contact details stored once on the clinic's
 * Tenant row and shown/edited by the lab portal (client detail), the clinic
 * onboarding wizard and the clinic settings screen.
 *
 * Per lab–clinic data (client status, client type, pickup settings) is NOT
 * part of the profile.
 *
 * Update semantics everywhere the profile is written:
 *   - field omitted (undefined) → existing value is preserved
 *   - field sent as null or '' → value is cleared (optional fields only;
 *     `name` and `email` cannot be cleared)
 */
export interface ClinicProfileModel {
  name: string;
  email: string | null;
  primaryContactName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 code, e.g. "CO" */
  country: string | null;
  /** Registered legal name ("razón social"), when different from `name` */
  legalName: string | null;
  /** One of TAX_ID_TYPES_BY_COUNTRY[country], or 'OTHER' — see tax-id-type.model.ts */
  taxIdType: string | null;
  /** ID number as entered (trimmed), e.g. "900.123.456-7" — for display */
  taxId: string | null;
}
