import { BadRequestException } from '@nestjs/common';
import {
  isTaxIdTypeForCountry,
  type ClinicProfileModel,
} from '@vet-ai/shared-types';

/**
 * Shared clinic profile — stored once on the clinic's Tenant row and written by
 * three flows: lab client edit, clinic onboarding and clinic settings.
 *
 * Every writer goes through buildClinicProfileUpdate() so they all agree on:
 *   - undefined → field omitted, existing value preserved
 *   - null / '' / whitespace → field cleared (stored as null)
 *   - name and email can never be cleared
 *   - taxIdNormalized follows taxId (set or cleared with it) and is never
 *     accepted from a client
 */
export const CLINIC_PROFILE_FIELDS = [
  'name',
  'email',
  'primaryContactName',
  'phone',
  'address',
  'city',
  'country',
  'legalName',
  'taxIdType',
  'taxId',
] as const satisfies readonly (keyof ClinicProfileModel)[];

export type ClinicProfileField = (typeof CLINIC_PROFILE_FIELDS)[number];

export type ClinicProfileInput = {
  [K in ClinicProfileField]?: string | null;
};

const REQUIRED_FIELDS: ReadonlySet<ClinicProfileField> = new Set([
  'name',
  'email',
]);

/** Prisma `select` for the full clinic profile. */
export const CLINIC_PROFILE_SELECT = {
  name: true,
  email: true,
  primaryContactName: true,
  phone: true,
  address: true,
  city: true,
  country: true,
  legalName: true,
  taxIdType: true,
  taxId: true,
} as const satisfies Record<ClinicProfileField, true>;

/** Prisma-ready update: `name` is never null (the column is required). */
export type ClinicProfileUpdate = { name?: string } & {
  [K in Exclude<ClinicProfileField, 'name'>]?: string | null;
} & { taxIdNormalized?: string | null };

/**
 * Comparison key for a tax ID: uppercase, without spaces, `.`, `-` and `/`.
 * Leading zeros, letters and check digits are kept ("12.345.678-k" →
 * "12345678K", "0012345" stays "0012345"). Returns null when nothing is left.
 */
export function normalizeTaxId(taxId: string): string | null {
  const normalized = taxId.toUpperCase().replace(/[\s.\-/]/g, '');
  return normalized === '' ? null : normalized;
}

export function buildClinicProfileUpdate(
  input: ClinicProfileInput
): ClinicProfileUpdate {
  const data: Partial<Record<ClinicProfileField, string | null>> = {};

  for (const field of CLINIC_PROFILE_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;

    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === null || value === '') {
      if (REQUIRED_FIELDS.has(field)) {
        throw new BadRequestException(`${field} cannot be empty.`);
      }
      data[field] = null;
    } else {
      data[field] = value;
    }
  }

  const update = data as ClinicProfileUpdate;
  if (update.taxId !== undefined) {
    update.taxIdNormalized =
      update.taxId === null ? null : normalizeTaxId(update.taxId);
  }

  // REQUIRED_FIELDS above guarantees name/email are never null here.
  return update;
}

export type TaxIdentityErrorCode =
  | 'INVALID_TAX_ID_TYPE'
  | 'INVALID_TAX_ID'
  | 'TAX_ID_INCOMPLETE';

export interface TaxIdentityError {
  field: 'taxIdType' | 'taxId';
  code: TaxIdentityErrorCode;
}

export interface TaxIdentity {
  country?: string | null;
  taxIdType?: string | null;
  taxId?: string | null;
}

const optional = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Rules that span several fields:
 *   - taxIdType must exist for the country, or be 'OTHER';
 *   - a taxId needs a taxIdType and a country, so the duplicate key is complete;
 *   - a taxId must keep at least one digit or letter once normalized.
 */
export function checkTaxIdentity(input: TaxIdentity): TaxIdentityError[] {
  const country = optional(input.country);
  const taxIdType = optional(input.taxIdType);
  const taxId = optional(input.taxId);
  const errors: TaxIdentityError[] = [];

  if (taxIdType && !isTaxIdTypeForCountry(taxIdType, country)) {
    errors.push({ field: 'taxIdType', code: 'INVALID_TAX_ID_TYPE' });
  }
  if (taxId) {
    if (!taxIdType || !country) {
      errors.push({ field: 'taxId', code: 'TAX_ID_INCOMPLETE' });
    } else if (!normalizeTaxId(taxId)) {
      errors.push({ field: 'taxId', code: 'INVALID_TAX_ID' });
    }
  }
  return errors;
}

/**
 * Throws unless the tax identity after an update is valid. Fields the update
 * omits (undefined) keep their `stored` value, so changing only the country
 * still checks that the stored ID type fits the new one.
 */
export function assertValidTaxIdentity(
  update: TaxIdentity,
  stored: TaxIdentity | null = null
): void {
  const pick = (field: keyof TaxIdentity) =>
    update[field] !== undefined ? update[field] : stored?.[field];
  const errors = checkTaxIdentity({
    country: pick('country'),
    taxIdType: pick('taxIdType'),
    taxId: pick('taxId'),
  });
  if (errors.length > 0) {
    throw new BadRequestException(
      `Invalid tax ID: ${errors.map((e) => `${e.field} ${e.code}`).join(', ')}.`
    );
  }
}

/** True when an update touches a field the tax ID rules depend on. */
export function touchesTaxIdentity(update: TaxIdentity): boolean {
  return (
    update.country !== undefined ||
    update.taxIdType !== undefined ||
    update.taxId !== undefined
  );
}
