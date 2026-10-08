import { BadRequestException } from '@nestjs/common';
import type { ClinicProfileModel } from '@vet-ai/shared-types';

/**
 * Shared clinic profile — stored once on the clinic's Tenant row and written by
 * three flows: lab client edit, clinic onboarding and clinic settings.
 *
 * Every writer goes through buildClinicProfileUpdate() so they all agree on:
 *   - undefined → field omitted, existing value preserved
 *   - null / '' / whitespace → field cleared (stored as null)
 *   - name and email can never be cleared
 */
export const CLINIC_PROFILE_FIELDS = [
  'name',
  'email',
  'primaryContactName',
  'phone',
  'address',
  'city',
  'country',
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
} as const satisfies Record<ClinicProfileField, true>;

/** Prisma-ready update: `name` is never null (the column is required). */
export type ClinicProfileUpdate = { name?: string } & {
  [K in Exclude<ClinicProfileField, 'name'>]?: string | null;
};

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

  // REQUIRED_FIELDS above guarantees name/email are never null here.
  return data as ClinicProfileUpdate;
}
