import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export const BILLING_CODE_MAX_LENGTH = 50;

/**
 * A billing code as stored: trimmed, otherwise exactly what the lab's billing
 * system uses. Empty/undefined means "no code". Control characters (line
 * breaks, tabs) are rejected: they would break the export files.
 */
export function normalizeBillingCode(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) return null;
  const code = raw.trim();
  if (code === '') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(code)) {
    throw new BadRequestException(
      'A billing code cannot contain line breaks or tabs.'
    );
  }
  if (code.length > BILLING_CODE_MAX_LENGTH) {
    throw new BadRequestException(
      `A billing code can have at most ${BILLING_CODE_MAX_LENGTH} characters.`
    );
  }
  return code;
}

/**
 * Throws when another item of the same lab already uses the code. Compared
 * case-insensitively ("alt" vs "ALT" are the same code to a billing system),
 * although the database index itself is case-sensitive.
 */
export async function assertBillingCodeAvailable(
  prisma: Pick<PrismaService, 'catalogItem'>,
  labTenantId: string,
  code: string,
  exceptItemId?: string
): Promise<void> {
  const clash = await prisma.catalogItem.findFirst({
    where: {
      labTenantId,
      billingCode: { equals: code, mode: 'insensitive' },
      ...(exceptItemId && { id: { not: exceptItemId } }),
    },
    select: { name: true },
  });
  if (clash) {
    throw new ConflictException(
      `The billing code "${code}" is already used by "${clash.name}".`
    );
  }
}
