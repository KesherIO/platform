import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async submitForReview(
    orderId: string,
    labTenantId: string,
    actorId: string,
    actorName: string,
    testIds?: string[]
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
    if (
      order.resultReport.status !== 'DRAFT' &&
      order.resultReport.status !== 'IN_REVIEW' &&
      order.resultReport.status !== 'RELEASED'
    ) {
      throw new BadRequestException(
        `Report is ${order.resultReport.status}, cannot submit for review.`
      );
    }

    let enteredTests = order.orderedTests.filter(
      (t) => t.status === 'RESULTS_ENTERED'
    );
    if (testIds && testIds.length > 0) {
      enteredTests = enteredTests.filter((t) => testIds.includes(t.id));
    }
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

    const submittedTestIds = enteredTests.map((t) => t.id);
    const reportId = order.resultReport.id;

    await this.prisma.$transaction(async (tx) => {
      await tx.orderedTest.updateMany({
        where: { id: { in: submittedTestIds } },
        data: { status: 'IN_REVIEW', version: { increment: 1 } },
      });

      await tx.resultReportTest.updateMany({
        where: { orderedTestId: { in: submittedTestIds } },
        data: { status: 'IN_REVIEW' },
      });

      if (order.resultReport!.status === 'DRAFT') {
        await tx.resultReport.update({
          where: { id: reportId },
          data: {
            status: 'IN_REVIEW',
            submittedForReviewAt: new Date(),
            submittedByUserId: actorId,
            correctionNotes: null,
          },
        });
      }

      await tx.timelineEvent.create({
        data: {
          orderId,
          eventType: 'SUBMITTED_FOR_REVIEW',
          actorId,
          actorName,
          description: 'Report submitted for review',
          metadata: {
            reportId,
            testCount: submittedTestIds.length,
            testIds: submittedTestIds,
          },
        },
      });
    });

    return { status: 'IN_REVIEW', reportId };
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

      await tx.resultReportTest.updateMany({
        where: { orderedTestId: { in: revertTestIds } },
        data: { status: 'DRAFT' },
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
}
