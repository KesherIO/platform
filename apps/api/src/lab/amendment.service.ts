import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, type ReleaseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusService } from './order-status.service';
import { evaluateAllFormulas } from './formula.util';
import type { ReferenceRangeSnapshot } from '@vet-ai/shared-types';

type TxClient = Prisma.TransactionClient;

interface InitiateAmendmentInput {
  orderId: string;
  labTenantId: string;
  reportTestId: string;
  reason: string;
  actorId: string;
  actorName: string;
}

interface EditAmendmentAnalytesInput {
  orderId: string;
  labTenantId: string;
  amendmentId: string;
  analytes: Array<{
    id: string;
    numericValue?: number | null;
    textValue?: string | null;
    booleanValue?: boolean | null;
    selectValue?: string | null;
  }>;
}

interface SubmitAmendmentInput {
  orderId: string;
  labTenantId: string;
  amendmentId: string;
  actorId: string;
  actorName: string;
}

interface ApproveAmendmentInput {
  orderId: string;
  labTenantId: string;
  amendmentId: string;
  signerId: string;
  reviewNotes?: string;
  observations?: string;
  actorId: string;
  actorName: string;
}

interface CancelAmendmentInput {
  orderId: string;
  labTenantId: string;
  amendmentId: string;
  actorId: string;
  actorName: string;
}

@Injectable()
export class AmendmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatusService: OrderStatusService
  ) {}

  async initiateAmendment(input: InitiateAmendmentInput) {
    const { orderId, labTenantId, reportTestId, reason, actorId, actorName } =
      input;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Amendment reason is required.');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        resultReport: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport)
      throw new BadRequestException('No report exists for this order.');

    const reportTest = await this.prisma.resultReportTest.findUnique({
      where: { id: reportTestId },
      select: {
        id: true,
        reportId: true,
        status: true,
        latestReleaseId: true,
      },
    });

    if (!reportTest || reportTest.reportId !== order.resultReport.id) {
      throw new NotFoundException('Report test not found.');
    }

    if (reportTest.status !== 'RELEASED') {
      throw new BadRequestException('Only released tests can be amended.');
    }

    const activeAmendment = await this.prisma.resultReportAmendment.findFirst({
      where: {
        reportTestId,
        status: { in: ['DRAFT', 'IN_REVIEW'] },
      },
    });
    if (activeAmendment) {
      throw new ConflictException(
        'An active amendment already exists for this test.'
      );
    }

    if (!reportTest.latestReleaseId) {
      throw new BadRequestException('Released test has no associated release.');
    }

    const releaseTest = await this.prisma.resultReportReleaseTest.findFirst({
      where: {
        releaseId: reportTest.latestReleaseId,
        sourceReportTestId: reportTestId,
      },
      include: {
        analytes: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!releaseTest) {
      throw new BadRequestException('No release snapshot found for this test.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const amendment = await tx.resultReportAmendment.create({
        data: {
          reportId: order.resultReport!.id,
          reportTestId,
          sourceReleaseId: reportTest.latestReleaseId!,
          status: 'DRAFT',
          reason: reason.trim(),
        },
      });

      const amendmentAnalytes = await Promise.all(
        releaseTest.analytes.map((a) =>
          tx.resultReportAmendmentAnalyte.create({
            data: {
              amendmentId: amendment.id,
              code: a.code,
              name: a.name,
              sectionName: a.sectionName,
              sortOrder: a.sortOrder,
              isHeader: a.isHeader,
              valueType: a.valueType,
              numericValue: a.numericValue,
              textValue: a.textValue,
              booleanValue: a.booleanValue,
              selectValue: a.selectValue,
              unit: a.unit,
              technique: a.technique,
              formula: a.formula,
              flag: a.flag,
              referenceSnapshot: a.referenceSnapshot ?? undefined,
            },
          })
        )
      );

      await tx.timelineEvent.create({
        data: {
          orderId,
          eventType: 'AMENDMENT_INITIATED',
          actorId,
          actorName,
          description: `Amendment initiated for ${
            releaseTest.catalogItemName
          }: ${reason.trim()}`,
          metadata: {
            amendmentId: amendment.id,
            reportTestId,
            sourceReleaseId: reportTest.latestReleaseId,
          },
        },
      });

      return { amendment, analytes: amendmentAnalytes };
    });

    return {
      amendmentId: result.amendment.id,
      status: result.amendment.status,
      analytes: result.analytes,
    };
  }

  async getAmendment(
    orderId: string,
    labTenantId: string,
    amendmentId: string
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true, resultReport: { select: { id: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const amendment = await this.prisma.resultReportAmendment.findUnique({
      where: { id: amendmentId },
      include: {
        analytes: { orderBy: { sortOrder: 'asc' } },
        reportTest: {
          select: {
            id: true,
            orderedTestId: true,
            templateVersion: { select: { title: true } },
          },
        },
        report: { select: { orderId: true } },
      },
    });

    if (!amendment || amendment.report.orderId !== orderId) {
      throw new NotFoundException('Amendment not found.');
    }

    const sourceAnalytes = amendment.sourceReleaseId
      ? await this.prisma.resultReportReleaseAnalyte.findMany({
          where: {
            releaseTest: {
              releaseId: amendment.sourceReleaseId,
              sourceReportTestId: amendment.reportTestId,
            },
          },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    return { amendment, sourceAnalytes };
  }

  async editAmendmentAnalytes(input: EditAmendmentAnalytesInput) {
    const { orderId, labTenantId, amendmentId, analytes } = input;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const amendment = await this.prisma.resultReportAmendment.findUnique({
      where: { id: amendmentId },
      select: {
        id: true,
        status: true,
        reportTest: { select: { report: { select: { orderId: true } } } },
      },
    });

    if (!amendment || amendment.reportTest.report.orderId !== orderId) {
      throw new NotFoundException('Amendment not found.');
    }

    if (amendment.status !== 'DRAFT') {
      throw new BadRequestException(
        'Can only edit analytes on DRAFT amendments.'
      );
    }

    for (const a of analytes) {
      await this.prisma.resultReportAmendmentAnalyte.update({
        where: { id: a.id },
        data: {
          numericValue: a.numericValue ?? null,
          textValue: a.textValue ?? null,
          booleanValue: a.booleanValue ?? null,
          selectValue: a.selectValue ?? null,
        },
      });
    }

    return { updated: analytes.length };
  }

  async submitForReview(input: SubmitAmendmentInput) {
    const { orderId, labTenantId, amendmentId, actorId, actorName } = input;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const amendment = await this.prisma.resultReportAmendment.findUnique({
      where: { id: amendmentId },
      include: {
        analytes: true,
        reportTest: { select: { report: { select: { orderId: true } } } },
      },
    });

    if (!amendment || amendment.reportTest.report.orderId !== orderId) {
      throw new NotFoundException('Amendment not found.');
    }

    if (amendment.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only DRAFT amendments can be submitted for review.'
      );
    }

    const nonHeaderAnalytes = amendment.analytes.filter(
      (a) => !a.isHeader && !a.formula
    );
    const missingValues = nonHeaderAnalytes.filter(
      (a) =>
        a.numericValue === null &&
        (a.textValue === null || a.textValue === '') &&
        a.booleanValue === null &&
        (a.selectValue === null || a.selectValue === '')
    );

    if (missingValues.length > 0) {
      throw new BadRequestException(
        `Missing required analyte values: ${missingValues
          .map((a) => a.name)
          .join(', ')}`
      );
    }

    await this.prisma.resultReportAmendment.update({
      where: { id: amendmentId },
      data: {
        status: 'IN_REVIEW',
        submittedForReviewAt: new Date(),
        submittedByUserId: actorId,
      },
    });

    await this.prisma.timelineEvent.create({
      data: {
        orderId,
        eventType: 'AMENDMENT_SUBMITTED_FOR_REVIEW',
        actorId,
        actorName,
        description: `Amendment submitted for review`,
        metadata: { amendmentId },
      },
    });

    return { status: 'IN_REVIEW' as const };
  }

  async approveAmendment(input: ApproveAmendmentInput) {
    const {
      orderId,
      labTenantId,
      amendmentId,
      signerId,
      reviewNotes,
      observations,
      actorId,
      actorName,
    } = input;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        caseId: true,
        requisitionNumber: true,
        priority: true,
        clinicNotes: true,
        createdAt: true,
        tenantId: true,
        labTenantId: true,
        resultReport: { select: { id: true, currentReleaseSequence: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport)
      throw new BadRequestException('No report exists for this order.');

    const amendment = await this.prisma.resultReportAmendment.findUnique({
      where: { id: amendmentId },
      include: {
        analytes: { orderBy: { sortOrder: 'asc' } },
        reportTest: {
          select: {
            id: true,
            orderedTestId: true,
            latestReleaseId: true,
            templateDefinition: { select: { id: true } },
            templateVersion: {
              select: { id: true, title: true, version: true },
            },
            orderedTest: {
              select: {
                catalogItemCode: true,
                catalogItemName: true,
                department: true,
                processingMethod: true,
                entryMethod: true,
                startedAt: true,
                completedAt: true,
                specimens: {
                  select: {
                    specimen: {
                      select: { accessionNumber: true, specimenType: true },
                    },
                  },
                },
              },
            },
          },
        },
        report: { select: { orderId: true } },
      },
    });

    if (!amendment || amendment.report.orderId !== orderId) {
      throw new NotFoundException('Amendment not found.');
    }

    if (amendment.status !== 'IN_REVIEW') {
      throw new BadRequestException(
        'Only IN_REVIEW amendments can be approved.'
      );
    }

    await this.validateReviewerAuthorization(labTenantId, signerId);

    const signer = await this.prisma.labSigner.findUnique({
      where: { id: signerId },
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
    if (!signer) throw new NotFoundException('Signer not found.');

    const priorReleaseTestId = await this.findPriorReleaseTestId(amendment);

    const hasFormulas = amendment.analytes.some(
      (a) => a.formula && !a.isHeader
    );
    let computedValues: Record<string, number | null> = {};
    if (hasFormulas) {
      const allForEval = amendment.analytes
        .filter((a) => !a.isHeader)
        .map((a) => ({
          code: a.code,
          formula: a.formula ?? null,
          numericValue: a.numericValue ?? null,
        }));
      computedValues = evaluateAllFormulas(allForEval);

      for (const a of amendment.analytes) {
        if (!a.formula || a.isHeader) continue;
        const value = computedValues[a.code] ?? null;
        if (value !== null) {
          await this.prisma.resultReportAmendmentAnalyte.update({
            where: { id: a.id },
            data: { numericValue: value },
          });
          (a as { numericValue: typeof value }).numericValue = value;
        }
      }
    }

    const reportId = order.resultReport.id;

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM result_reports WHERE id = ${reportId} FOR UPDATE`;

        const report = await tx.resultReport.findUniqueOrThrow({
          where: { id: reportId },
          select: { currentReleaseSequence: true },
        });

        const newSequence = report.currentReleaseSequence + 1;
        const releaseType: ReleaseType = 'AMENDMENT';

        const snapshots = await this.buildSnapshotFields(tx, order, signer);

        const release = await tx.resultReportRelease.create({
          data: {
            reportId,
            releaseSequence: newSequence,
            releaseType,
            signerId: signer.id,
            signerName: signer.name,
            signerTitle: signer.title || null,
            signerSpecialty: signer.specialty || null,
            signerUniversity: signer.university || null,
            signerRegistrationNumber: signer.registrationNumber || null,
            signerSignatureUrl: signer.signatureUrl ?? null,
            releasedByUserId: actorId,
            releasedByName: actorName,
            reviewNotes: reviewNotes ?? null,
            observations: observations ?? null,
            ...snapshots,
          },
        });

        const ot = amendment.reportTest.orderedTest;
        const specimens = ot?.specimens ?? [];
        const now = new Date();

        const releaseTest = await tx.resultReportReleaseTest.create({
          data: {
            releaseId: release.id,
            sourceReportTestId: amendment.reportTest.id,
            orderedTestId: amendment.reportTest.orderedTestId,
            amendsReleaseTestId: priorReleaseTestId,
            catalogItemCode: ot?.catalogItemCode ?? null,
            catalogItemName:
              ot?.catalogItemName ?? amendment.reportTest.templateVersion.title,
            department: ot?.department ?? null,
            processingMethod: ot?.processingMethod ?? null,
            entryMethod: ot?.entryMethod ?? 'MANUAL',
            templateDefinitionId: amendment.reportTest.templateDefinition.id,
            templateVersionId: amendment.reportTest.templateVersion.id,
            templateTitle: amendment.reportTest.templateVersion.title,
            templateVersion: amendment.reportTest.templateVersion.version,
            specimenAccessionNumbers: specimens.map(
              (s) => s.specimen.accessionNumber
            ),
            specimenTypes: specimens.map((s) => s.specimen.specimenType),
            testStartedAt: ot?.startedAt ?? null,
            testCompletedAt: now,
            resultsEnteredAt: ot?.completedAt ?? null,
          },
        });

        for (const a of amendment.analytes) {
          const ref = a.referenceSnapshot as ReferenceRangeSnapshot | null;
          const flag =
            a.valueType === 'NUMERIC' && a.numericValue != null
              ? this.computeFlag(ref, a.numericValue)
              : a.flag;

          await tx.resultReportReleaseAnalyte.create({
            data: {
              releaseTestId: releaseTest.id,
              code: a.code,
              name: a.name,
              sectionName: a.sectionName ?? null,
              sortOrder: a.sortOrder,
              isHeader: a.isHeader,
              valueType: a.valueType,
              numericValue: a.numericValue ?? null,
              textValue: a.textValue ?? null,
              booleanValue: a.booleanValue ?? null,
              selectValue: a.selectValue ?? null,
              unit: a.unit ?? null,
              technique: a.technique ?? null,
              formula: a.formula ?? null,
              flag,
              referenceSnapshot:
                (ref as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            },
          });
        }

        await tx.resultReportTest.update({
          where: { id: amendment.reportTest.id },
          data: {
            latestReleaseId: release.id,
            latestReleasedAt: now,
          },
        });

        await tx.resultReportAmendment.update({
          where: { id: amendmentId },
          data: {
            status: 'APPROVED',
            resultingReleaseId: release.id,
            reviewedBySignerId: signerId,
            reviewedAt: now,
            reviewNotes: reviewNotes ?? null,
          },
        });

        await tx.resultReport.update({
          where: { id: reportId },
          data: { currentReleaseSequence: newSequence },
        });

        await tx.resultReportReleaseArtifact.create({
          data: { releaseId: release.id, artifactType: 'PDF' },
        });

        await tx.timelineEvent.create({
          data: {
            orderId,
            eventType: 'AMENDMENT_APPROVED',
            actorId,
            actorName,
            description: `Amendment release #${newSequence} approved by ${signer.name}`,
            metadata: {
              releaseId: release.id,
              amendmentId,
              releaseSequence: newSequence,
              releaseType,
              signerId: signer.id,
              amendsReleaseTestId: priorReleaseTestId,
            },
          },
        });

        await this.orderStatusService.deriveAndPersist(orderId, tx);

        return {
          releaseId: release.id,
          releaseSequence: newSequence,
          releaseType,
          amendsReleaseTestId: priorReleaseTestId,
        };
      },
      { timeout: 15000 }
    );

    const amendments = await this.prisma.resultReportAmendment.findMany({
      where: {
        reportId,
        status: { in: ['DRAFT', 'IN_REVIEW'] },
      },
      select: { id: true },
    });

    const aggregateReportStatus =
      amendments.length > 0 ? 'AMENDMENT_PENDING' : 'ALL_RELEASED';

    return { ...result, aggregateReportStatus };
  }

  async cancelAmendment(input: CancelAmendmentInput) {
    const { orderId, labTenantId, amendmentId, actorId, actorName } = input;

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const amendment = await this.prisma.resultReportAmendment.findUnique({
      where: { id: amendmentId },
      select: {
        id: true,
        status: true,
        reportTest: { select: { report: { select: { orderId: true } } } },
      },
    });

    if (!amendment || amendment.reportTest.report.orderId !== orderId) {
      throw new NotFoundException('Amendment not found.');
    }

    if (amendment.status !== 'DRAFT' && amendment.status !== 'IN_REVIEW') {
      throw new BadRequestException(
        'Only active amendments (DRAFT or IN_REVIEW) can be cancelled.'
      );
    }

    await this.prisma.resultReportAmendment.update({
      where: { id: amendmentId },
      data: { status: 'CANCELLED' },
    });

    await this.prisma.timelineEvent.create({
      data: {
        orderId,
        eventType: 'AMENDMENT_CANCELLED',
        actorId,
        actorName,
        description: `Amendment cancelled`,
        metadata: { amendmentId },
      },
    });

    return { status: 'CANCELLED' as const };
  }

  private async findPriorReleaseTestId(amendment: {
    reportTest: { id: string; latestReleaseId: string | null };
  }): Promise<string | null> {
    if (!amendment.reportTest.latestReleaseId) return null;

    const priorReleaseTest =
      await this.prisma.resultReportReleaseTest.findFirst({
        where: {
          releaseId: amendment.reportTest.latestReleaseId,
          sourceReportTestId: amendment.reportTest.id,
        },
        select: { id: true },
      });

    return priorReleaseTest?.id ?? null;
  }

  private async buildSnapshotFields(
    tx: TxClient,
    order: {
      id: string;
      caseId: string;
      requisitionNumber: string;
      priority: string;
      clinicNotes: string | null;
      createdAt: Date;
      tenantId: string;
      labTenantId: string | null;
    },
    _signer: { id: string }
  ) {
    const caseData = await tx.case.findUniqueOrThrow({
      where: { id: order.caseId },
      select: {
        patientName: true,
        patientSpecies: true,
        patientSex: true,
        patientBreed: true,
        patientAge: true,
        patientAgeUnit: true,
        patientDateOfBirth: true,
        patientWeight: true,
        ownerName: true,
        ownerPhone: true,
      },
    });

    const clinicTenant = await tx.tenant.findUniqueOrThrow({
      where: { id: order.tenantId },
      select: { name: true, address: true, phone: true, logoUrl: true },
    });

    let labSnapshot = {
      labTenantId: order.labTenantId ?? order.tenantId,
      labName: '',
      labAccreditationNumber: null as string | null,
      labDirectorName: null as string | null,
      labDirectorCredentials: null as string | null,
      labLogoUrl: null as string | null,
      labAddress: null as string | null,
      labPhone: null as string | null,
    };

    if (order.labTenantId) {
      const labTenant = await tx.tenant.findUnique({
        where: { id: order.labTenantId },
        select: { name: true, address: true, phone: true, logoUrl: true },
      });
      const labProfile = await tx.laboratoryProfile.findUnique({
        where: { tenantId: order.labTenantId },
        select: {
          accreditationNumber: true,
          directorName: true,
          directorCredentials: true,
        },
      });
      labSnapshot = {
        labTenantId: order.labTenantId,
        labName: labTenant?.name ?? '',
        labAccreditationNumber: labProfile?.accreditationNumber ?? null,
        labDirectorName: labProfile?.directorName ?? null,
        labDirectorCredentials: labProfile?.directorCredentials ?? null,
        labLogoUrl: labTenant?.logoUrl ?? null,
        labAddress: labTenant?.address ?? null,
        labPhone: labTenant?.phone ?? null,
      };
    }

    return {
      ...labSnapshot,
      orderId: order.id,
      requisitionNumber: order.requisitionNumber,
      orderPriority: order.priority,
      orderClinicNotes: order.clinicNotes ?? null,
      orderCreatedAt: order.createdAt,
      patientName: caseData.patientName,
      patientSpecies: caseData.patientSpecies,
      patientSex: caseData.patientSex ?? null,
      patientBreed: caseData.patientBreed ?? null,
      patientAge: caseData.patientAge ?? null,
      patientAgeUnit: caseData.patientAgeUnit ?? null,
      patientDateOfBirth: caseData.patientDateOfBirth ?? null,
      patientWeight: caseData.patientWeight ?? null,
      ownerName: caseData.ownerName,
      ownerPhone: caseData.ownerPhone ?? null,
      clinicTenantId: order.tenantId,
      clinicName: clinicTenant.name,
      clinicAddress: clinicTenant.address ?? null,
      clinicPhone: clinicTenant.phone ?? null,
      clinicLogoUrl: clinicTenant.logoUrl ?? null,
    };
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
    if (!signer) throw new NotFoundException('Signer not found.');
    if (signer.laboratoryProfile.tenantId !== labTenantId) {
      throw new ForbiddenException(
        'Signer does not belong to this laboratory.'
      );
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
