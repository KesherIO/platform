import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusService } from './order-status.service';
import { evaluateAllFormulas } from './formula.util';
import type { ReferenceRangeSnapshot } from '@vet-ai/shared-types';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatusService: OrderStatusService
  ) {}

  async submitForReview(
    orderId: string,
    labTenantId: string,
    actorId: string,
    actorName: string
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        orderedTests: {
          select: { id: true, status: true, catalogItemName: true },
        },
        resultReport: { select: { id: true, status: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport) {
      throw new BadRequestException('No report exists for this order.');
    }
    if (order.resultReport.status !== 'DRAFT') {
      throw new BadRequestException(
        `Report is ${order.resultReport.status}, expected DRAFT.`
      );
    }

    const enteredTests = order.orderedTests.filter(
      (t) => t.status === 'RESULTS_ENTERED'
    );
    if (enteredTests.length === 0) {
      throw new BadRequestException(
        'At least one test must have results entered before submitting for review.'
      );
    }

    const reviewers = await this.getReviewerSigners(labTenantId);
    if (reviewers.length === 0) {
      throw new BadRequestException(
        'Cannot submit for review: no reviewer signers configured for this laboratory.'
      );
    }

    const testIds = enteredTests.map((t) => t.id);
    const reportId = order.resultReport.id;

    await this.prisma.$transaction(async (tx) => {
      await tx.orderedTest.updateMany({
        where: { id: { in: testIds } },
        data: { status: 'IN_REVIEW', version: { increment: 1 } },
      });

      await tx.resultReport.update({
        where: { id: reportId },
        data: {
          status: 'IN_REVIEW',
          submittedForReviewAt: new Date(),
          submittedByUserId: actorId,
          correctionNotes: null,
        },
      });

      await tx.timelineEvent.create({
        data: {
          orderId,
          eventType: 'SUBMITTED_FOR_REVIEW',
          actorId,
          actorName,
          description: 'Report submitted for review',
          metadata: { reportId, testCount: testIds.length },
        },
      });
    });

    return { status: 'IN_REVIEW', reportId };
  }

  async approveAndRelease(
    orderId: string,
    labTenantId: string,
    signerId: string,
    reviewNotes: string | undefined,
    actorId: string,
    actorName: string
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        caseId: true,
        orderedTests: { select: { id: true, status: true } },
        resultReport: { select: { id: true, status: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport) {
      throw new BadRequestException('No report exists for this order.');
    }
    if (order.resultReport.status !== 'IN_REVIEW') {
      throw new BadRequestException(
        `Report is ${order.resultReport.status}, expected IN_REVIEW.`
      );
    }

    await this.validateReviewerAuthorization(labTenantId, signerId);

    const signer = await this.prisma.labSigner.findUnique({
      where: { id: signerId },
      select: {
        name: true,
        title: true,
        university: true,
        registrationNumber: true,
        signatureUrl: true,
      },
    });
    if (!signer) throw new NotFoundException('Signer not found.');

    const reportId = order.resultReport.id;
    const reportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId },
      include: {
        analytes: {
          include: { templateAnalyte: { select: { referenceRange: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    // Recompute formula analytes before flag computation
    for (const rt of reportTests) {
      const hasFormulas = rt.analytes.some((a) => a.formula && !a.isHeader);
      if (!hasFormulas) continue;

      const allForEval = rt.analytes
        .filter((a) => !a.isHeader)
        .map((a) => ({
          code: a.code,
          formula: a.formula ?? null,
          numericValue: a.numericValue ? Number(a.numericValue) : null,
        }));

      const computed = evaluateAllFormulas(allForEval);

      for (const a of rt.analytes) {
        if (!a.formula || a.isHeader) continue;
        const value = computed[a.code] ?? null;
        if (value !== null) {
          await this.prisma.resultReportAnalyte.update({
            where: { id: a.id },
            data: { numericValue: value },
          });
          (a as { numericValue: typeof value }).numericValue = value;
        }
      }
    }

    const allAnalytes = reportTests.flatMap((rt) => rt.analytes);
    const inReviewTestIds = order.orderedTests
      .filter((t) => t.status === 'IN_REVIEW')
      .map((t) => t.id);

    const approvedByCredentials = [signer.university, signer.registrationNumber]
      .filter(Boolean)
      .join('\n');

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        allAnalytes
          .filter((a) => !a.isHeader)
          .map((a) => {
            const ref = a.templateAnalyte
              ?.referenceRange as ReferenceRangeSnapshot | null;
            const flag =
              a.valueType === 'NUMERIC' && a.numericValue != null
                ? this.computeFlag(ref, Number(a.numericValue))
                : null;

            return tx.resultReportAnalyte.update({
              where: { id: a.id },
              data: {
                flag,
                referenceSnapshot:
                  (ref as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
              },
            });
          })
      );

      await tx.resultReport.update({
        where: { id: reportId },
        data: {
          status: 'RELEASED',
          reviewedBySignerId: signerId,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes ?? null,
          releasedAt: new Date(),
          releasedByUserId: actorId,
          approvedByName: signer.name,
          approvedByRole: signer.title,
          approvedByCredentials: approvedByCredentials || null,
          signatureUrl: signer.signatureUrl ?? null,
          processedByName: actorName,
        },
      });

      await tx.orderedTest.updateMany({
        where: { id: { in: inReviewTestIds } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          version: { increment: 1 },
        },
      });

      await tx.timelineEvent.create({
        data: {
          orderId,
          eventType: 'REVIEW_APPROVED',
          actorId,
          actorName,
          description: `Report approved and released by ${signer.name}`,
          metadata: {
            reportId,
            signerId,
            signerName: signer.name,
          },
        },
      });
    });

    await this.orderStatusService.deriveAndPersist(orderId);

    return { status: 'RELEASED', reportId };
  }

  async requestCorrections(
    orderId: string,
    labTenantId: string,
    correctionNotes: string,
    testIds: string[] | undefined,
    actorId: string,
    actorName: string
  ) {
    if (!correctionNotes?.trim()) {
      throw new BadRequestException('Correction notes are required.');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        orderedTests: { select: { id: true, status: true } },
        resultReport: { select: { id: true, status: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport) {
      throw new BadRequestException('No report exists for this order.');
    }
    if (order.resultReport.status !== 'IN_REVIEW') {
      throw new BadRequestException(
        `Report is ${order.resultReport.status}, expected IN_REVIEW.`
      );
    }

    const reportId = order.resultReport.id;
    const inReviewTests = order.orderedTests.filter(
      (t) => t.status === 'IN_REVIEW'
    );
    const revertTestIds =
      testIds && testIds.length > 0
        ? inReviewTests.filter((t) => testIds.includes(t.id)).map((t) => t.id)
        : inReviewTests.map((t) => t.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.orderedTest.updateMany({
        where: { id: { in: revertTestIds } },
        data: {
          status: 'RESULTS_ENTERED',
          completedAt: null,
          version: { increment: 1 },
        },
      });

      await tx.resultReport.update({
        where: { id: reportId },
        data: {
          status: 'DRAFT',
          correctionNotes: correctionNotes.trim(),
          reviewedAt: null,
          reviewedBySignerId: null,
          reviewNotes: null,
        },
      });

      await tx.timelineEvent.create({
        data: {
          orderId,
          eventType: 'REVIEW_CORRECTIONS',
          actorId,
          actorName,
          description: 'Corrections requested',
          metadata: {
            reportId,
            correctionNotes: correctionNotes.trim(),
            revertedTestIds: revertTestIds,
          },
        },
      });
    });

    return { status: 'DRAFT', correctionNotes: correctionNotes.trim() };
  }

  async getReviewerSigners(labTenantId: string) {
    const profile = await this.prisma.laboratoryProfile.findUnique({
      where: { tenantId: labTenantId },
      select: { id: true },
    });
    if (!profile) return [];

    return this.prisma.labSigner.findMany({
      where: {
        laboratoryProfileId: profile.id,
        roles: { has: 'REVIEWER' },
      },
      select: {
        id: true,
        name: true,
        title: true,
        specialty: true,
        university: true,
        registrationNumber: true,
        signatureUrl: true,
        roles: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  private async validateReviewerAuthorization(
    labTenantId: string,
    signerId: string
  ) {
    const signer = await this.prisma.labSigner.findUnique({
      where: { id: signerId },
      select: {
        roles: true,
        laboratoryProfile: { select: { tenantId: true } },
      },
    });

    if (!signer) {
      throw new NotFoundException('Signer not found.');
    }
    if (signer.laboratoryProfile.tenantId !== labTenantId) {
      throw new ForbiddenException('Signer does not belong to this laboratory.');
    }
    if (!signer.roles.includes('REVIEWER')) {
      throw new ForbiddenException(
        'Selected signer does not have the REVIEWER role.'
      );
    }
  }

  private computeFlag(
    ref: ReferenceRangeSnapshot | null,
    value: number
  ): string | null {
    if (!ref || (ref.min == null && ref.max == null)) return null;
    if (ref.min != null && value < ref.min) return 'L';
    if (ref.max != null && value > ref.max) return 'H';
    return 'N';
  }
}
