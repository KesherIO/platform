import type { Prisma } from '@prisma/client';

/**
 * A new EXPECTED tube, numbered like the Accession dialog numbers extra
 * tubes (<requisition>-<n>), skipping numbers this lab already used.
 */
export async function createRequestedTube(
  tx: Prisma.TransactionClient,
  orderId: string,
  labTenantId: string,
  requisitionNumber: string,
  specimenType: string,
  containerType: string
) {
  const existing = await tx.specimen.findMany({
    where: { orderId },
    select: { specimenType: true, containerType: true, tubeIndex: true },
  });
  const tubeIndex =
    Math.max(
      0,
      ...existing
        .filter(
          (sp) =>
            sp.specimenType === specimenType &&
            sp.containerType === containerType
        )
        .map((sp) => sp.tubeIndex)
    ) + 1;

  const used = new Set(
    (
      await tx.specimen.findMany({
        where: {
          labTenantId,
          accessionNumber: { startsWith: requisitionNumber },
        },
        select: { accessionNumber: true },
      })
    ).map((sp) => sp.accessionNumber)
  );
  let n = existing.length + 1;
  while (used.has(`${requisitionNumber}-${n}`)) n++;

  return tx.specimen.create({
    data: {
      orderId,
      labTenantId,
      accessionNumber: `${requisitionNumber}-${n}`,
      specimenType,
      containerType,
      tubeIndex,
      status: 'EXPECTED',
    },
    select: { id: true, accessionNumber: true },
  });
}
