import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { isTaxIdTypeForCountry } from '@vet-ai/shared-types';
import { normalizeTaxId } from '../tenants/clinic-profile.util';
import { ImportClientRowDto } from './dto/import-clients.dto';
import type { ClientFieldsDto } from './dto/create-client.dto';

/**
 * Pure helpers for creating clients — shared by Add client and bulk import.
 * See docs/CLIENT_BULK_IMPORT_PLAN.md (A2, A3, A6).
 */

/** Codes, not English text: the lab app translates them. */
export type RowErrorCode =
  | 'REQUIRED'
  | 'INVALID'
  | 'INVALID_EMAIL'
  | 'TOO_LONG'
  | 'INVALID_COUNTRY'
  | 'INVALID_CLIENT_TYPE'
  | 'INVALID_TAX_ID_TYPE'
  | 'INVALID_TAX_ID'
  | 'TAX_ID_INCOMPLETE'
  | 'UNKNOWN_FIELD';

export interface RowFieldError {
  field: string;
  code: RowErrorCode;
}

export type SkipReason = 'EMAIL_EXISTS' | 'TAX_ID_EXISTS' | 'DUPLICATE_IN_FILE';

export type ImportRowResult =
  | { rowNumber: number; status: 'created'; clientId: string }
  | { rowNumber: number; status: 'would_create' }
  | { rowNumber: number; status: 'skipped'; reason: SkipReason }
  | { rowNumber: number; status: 'invalid'; errors: RowFieldError[] }
  | { rowNumber: number; status: 'conflict'; reason: 'BATCH_ROW_MISMATCH' }
  | { rowNumber: number; status: 'failed'; reason: 'UNEXPECTED' };

export interface ImportClientsResponse {
  results: ImportRowResult[];
  summary: {
    created: number;
    wouldCreate: number;
    skipped: number;
    invalid: number;
    conflict: number;
    failed: number;
  };
}

/** A validated new client — every optional value trimmed, empty → undefined. */
export interface NewClinicInput {
  name: string;
  clientType: string;
  email: string;
  primaryContactName?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  legalName?: string;
  taxIdType?: string;
  taxId?: string;
  notes?: string;
}

const optional = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function toNewClinicInput(dto: ClientFieldsDto): NewClinicInput {
  return {
    name: dto.name.trim(),
    clientType: dto.clientType,
    email: dto.primaryContactEmail.trim(),
    primaryContactName: optional(dto.primaryContactName),
    phone: optional(dto.phone),
    address: optional(dto.address),
    city: optional(dto.city),
    country: optional(dto.country),
    legalName: optional(dto.legalName),
    taxIdType: optional(dto.taxIdType),
    taxId: optional(dto.taxId),
    notes: optional(dto.notes),
  };
}

/** Duplicate key for an email: case-insensitive. */
export function clientEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Duplicate key for a tax ID: country + type + normalized number, never the
 * number alone. Null when any part is missing.
 */
export function clientTaxKey(input: {
  country?: string | null;
  taxIdType?: string | null;
  taxId?: string | null;
}): { country: string; taxIdType: string; taxIdNormalized: string } | null {
  const country = optional(input.country);
  const taxIdType = optional(input.taxIdType);
  const taxId = optional(input.taxId);
  const taxIdNormalized = taxId ? normalizeTaxId(taxId) : null;
  if (!country || !taxIdType || !taxIdNormalized) return null;
  return { country, taxIdType, taxIdNormalized };
}

export function taxKeyString(
  key: NonNullable<ReturnType<typeof clientTaxKey>>
): string {
  return `${key.country}|${key.taxIdType}|${key.taxIdNormalized}`;
}

/**
 * Rules that span several fields:
 *   - taxIdType must exist for the country, or be 'OTHER';
 *   - a taxId needs a taxIdType and a country, so the duplicate key is complete;
 *   - a taxId must keep at least one digit or letter once normalized.
 */
export function checkTaxIdentity(input: {
  country?: string | null;
  taxIdType?: string | null;
  taxId?: string | null;
}): RowFieldError[] {
  const country = optional(input.country);
  const taxIdType = optional(input.taxIdType);
  const taxId = optional(input.taxId);
  const errors: RowFieldError[] = [];

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

function errorCode(error: ValidationError): RowErrorCode {
  const constraints = Object.keys(error.constraints ?? {});
  if (constraints.includes('whitelistValidation')) return 'UNKNOWN_FIELD';
  if (error.value === undefined || error.value === null || error.value === '') {
    return 'REQUIRED';
  }
  if (constraints.includes('maxLength')) return 'TOO_LONG';
  if (constraints.includes('isEmail')) return 'INVALID_EMAIL';
  if (error.property === 'country') return 'INVALID_COUNTRY';
  if (error.property === 'clientType') return 'INVALID_CLIENT_TYPE';
  return 'INVALID';
}

/**
 * Validates one import row on its own (plan A3). Field rules come from
 * ClientFieldsDto, the same class Add client uses.
 */
export async function validateImportRow(
  raw: Record<string, unknown>
): Promise<
  | { ok: true; rowNumber: number; input: NewClinicInput }
  | { ok: false; rowNumber: number; errors: RowFieldError[] }
> {
  const row = plainToInstance(ImportClientRowDto, raw);
  const validationErrors = await validate(row, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const errors: RowFieldError[] = validationErrors.map((e) => ({
    field: e.property,
    code: errorCode(e),
  }));
  const invalidFields = new Set(errors.map((e) => e.field));
  errors.push(
    ...checkTaxIdentity(row).filter((e) => !invalidFields.has(e.field))
  );

  // The request DTO already guarantees an integer rowNumber.
  const rowNumber = raw['rowNumber'] as number;
  if (errors.length > 0) return { ok: false, rowNumber, errors };
  return { ok: true, rowNumber, input: toNewClinicInput(row) };
}

/**
 * SHA-256 of the row's normalized submitted values. Stored on the connection
 * so a retry with the same batch id + row number but different data is
 * detected (BATCH_ROW_MISMATCH) instead of being treated as a replay.
 */
export function hashImportRow(input: NewClinicInput): string {
  const values = [
    input.name,
    input.clientType,
    clientEmailKey(input.email),
    input.primaryContactName,
    input.phone,
    input.address,
    input.city,
    input.country,
    input.legalName,
    input.taxIdType,
    input.taxId ? normalizeTaxId(input.taxId) : null,
    input.notes,
  ].map((v) => v ?? null);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
