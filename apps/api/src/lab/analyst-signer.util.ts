import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export type AnalystSnapshotSource = {
  id: string;
  name: string;
  title: string;
  specialty: string;
  university: string;
  registrationNumber: string;
  signatureUrl: string | null;
};

/**
 * The analyst picked for a release (normal or amendment): this lab's signer
 * with the ANALYST role, linked to a current team member — same rule as the
 * analyst dropdown (getAnalystSigners). No analystId means no analyst.
 */
export async function findActiveAnalyst(
  prisma: Pick<PrismaService, 'labSigner'>,
  labTenantId: string,
  analystId: string | undefined
): Promise<AnalystSnapshotSource | null> {
  if (!analystId) return null;

  const analyst = await prisma.labSigner.findFirst({
    where: {
      id: analystId,
      laboratoryProfile: { tenantId: labTenantId },
      roles: { has: 'ANALYST' },
      user: {
        memberships: {
          some: { tenantId: labTenantId, status: 'ACTIVE' },
        },
      },
    },
    select: {
      id: true,
      name: true,
      title: true,
      specialty: true,
      university: true,
      registrationNumber: true,
      signatureUrl: true,
    },
  });
  if (!analyst) throw new NotFoundException('Analyst not found.');
  return analyst;
}

/** Release `analyst*` snapshot columns (all null without an analyst). */
export function analystSnapshotFields(analyst: AnalystSnapshotSource | null) {
  return {
    analystId: analyst?.id ?? null,
    analystName: analyst?.name ?? null,
    analystTitle: analyst?.title || null,
    analystSpecialty: analyst?.specialty || null,
    analystUniversity: analyst?.university || null,
    analystRegistrationNumber: analyst?.registrationNumber || null,
    analystSignatureUrl: analyst?.signatureUrl ?? null,
  };
}
