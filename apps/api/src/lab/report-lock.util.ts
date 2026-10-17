import type { Prisma } from '@prisma/client';

/**
 * Inside a transaction: the order's report (created if missing), locked with
 * the row lock that release, amendment approval, submit-for-review and result
 * entry take. Anything that changes which tests an order has — cancelling an
 * order or a test, adding tests — takes it too, so a release decides FINAL vs
 * PARTIAL against a set of tests nobody is changing at that moment.
 */
export async function lockOrderReport(
  tx: Prisma.TransactionClient,
  order: { id: string; caseId: string; tenantId: string }
): Promise<string> {
  const report = await tx.resultReport.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      caseId: order.caseId,
      tenantId: order.tenantId,
      status: 'DRAFT',
    },
    update: {},
    select: { id: true },
  });
  await tx.$queryRaw`SELECT id FROM result_reports WHERE id = ${report.id} FOR UPDATE`;
  return report.id;
}

/**
 * Closes tubes nobody is waiting for any more: EXPECTED or MISSING tubes of
 * the order whose linked tests are all finished or cancelled.
 */
export async function cancelUnneededSpecimens(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<string[]> {
  const candidates = await tx.specimen.findMany({
    where: { orderId, status: { in: ['EXPECTED', 'MISSING'] } },
    select: {
      id: true,
      orderedTests: { select: { orderedTest: { select: { status: true } } } },
    },
  });
  const unneeded = candidates
    .filter((sp) =>
      sp.orderedTests.every(
        (l) =>
          l.orderedTest.status === 'CANCELLED' ||
          l.orderedTest.status === 'COMPLETED'
      )
    )
    .map((sp) => sp.id);
  if (unneeded.length > 0) {
    await tx.specimen.updateMany({
      where: { id: { in: unneeded } },
      data: { status: 'CANCELLED' },
    });
  }
  return unneeded;
}
