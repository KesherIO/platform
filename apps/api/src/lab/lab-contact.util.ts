import { Prisma } from '@prisma/client';

// A type alias (not an interface) so it satisfies Prisma's JSON input type
export type LabPhoneSnapshot = {
  label: string;
  number: string;
};

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
          };
        })
        .filter((p) => p.number)
    : [];
  if (list.length > 0) return list;
  if (phone?.trim()) return [{ label: '', number: phone.trim() }];
  return Prisma.DbNull;
}
