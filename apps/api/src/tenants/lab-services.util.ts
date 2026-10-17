import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A lab can suspend services for one of its clinics (ClinicLabConnection.status
 * SUSPENDED). Only that lab relationship is affected: new orders, pickups and
 * AI analysis through that lab are refused, while existing orders keep flowing
 * and results, PDFs and saved AI analysis stay readable.
 *
 * The clinic app recognizes the code and shows its suspension notice.
 */
export const LAB_SERVICES_SUSPENDED = 'LAB_SERVICES_SUSPENDED';

export class LabServicesSuspendedException extends ForbiddenException {
  constructor() {
    super({
      code: LAB_SERVICES_SUSPENDED,
      message:
        'This laboratory has suspended services for your clinic. Existing orders, results and reports remain available.',
    });
  }
}

/** Whether the lab has suspended services for this clinic. */
export async function isLabServicesSuspended(
  prisma: PrismaService,
  clinicId: string,
  labId: string
): Promise<boolean> {
  const connection = await prisma.clinicLabConnection.findUnique({
    where: { clinicId_labId: { clinicId, labId } },
    select: { status: true },
  });
  return connection?.status === 'SUSPENDED';
}

/** Throws when the lab has suspended services for this clinic. */
export async function assertLabServicesActive(
  prisma: PrismaService,
  clinicId: string,
  labId: string
): Promise<void> {
  if (await isLabServicesSuspended(prisma, clinicId, labId)) {
    throw new LabServicesSuspendedException();
  }
}
