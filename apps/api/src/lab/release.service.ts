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

interface ApproveReleaseInput {
  orderId: string;
  labTenantId: string;
  signerId: string;
  analystId?: string;
  testIds: string[];
  reviewNotes?: string;
  observations?: string;
  actorId: string;
  actorName: string;
}

@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatusService: OrderStatusService
  ) {}

  async approveAndRelease(input: ApproveReleaseInput) {
    const {
      orderId,
      labTenantId,
      signerId,
      analystId,
      testIds,
      reviewNotes,
      observations,
      actorId,
      actorName,
    } = input;

    if (!testIds || testIds.length === 0) {
      throw new BadRequestException(
        'At least one test must be selected for release.'
      );
    }

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
        orderingVetId: true,
        orderingVetName: true,
        orderingVetLicenseNumber: true,
        orderingVetIssuingAuthority: true,
        resultReport: {
          select: { id: true, status: true, currentReleaseSequence: true },
        },
        orderedTests: {
          select: {
            id: true,
            status: true,
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
    });

    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport) {
      throw new BadRequestException('No report exists for this order.');
    }

    const reportId = order.resultReport.id;

    const reportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId, orderedTestId: { in: testIds } },
      include: {
        analytes: {
          include: { templateAnalyte: { select: { referenceRange: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        templateVersion: { select: { id: true, title: true, version: true } },
        templateDefinition: { select: { id: true } },
      },
    });

    if (reportTests.length !== testIds.length) {
      const found = new Set(reportTests.map((t) => t.orderedTestId));
      const missing = testIds.filter((id) => !found.has(id));
      throw new NotFoundException(
        `Report tests not found for ordered tests: ${missing.join(', ')}`
      );
    }

    const nonInReview = reportTests.filter((t) => t.status !== 'IN_REVIEW');
    if (nonInReview.length > 0) {
      throw new BadRequestException(
        `All selected tests must be IN_REVIEW. Found: ${nonInReview
          .map((t) => `${t.id}=${t.status}`)
          .join(', ')}`
      );
    }

    const reportTestIds = reportTests.map((t) => t.id);
    const activeAmendments = await this.prisma.resultReportAmendment.findMany({
      where: {
        reportTestId: { in: reportTestIds },
        status: { in: ['DRAFT', 'IN_REVIEW'] },
      },
      select: { reportTestId: true },
    });
    if (activeAmendments.length > 0) {
      throw new ConflictException(
        'Cannot release tests with active amendments. Cancel or complete the amendments first.'
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

    let analyst: {
      id: string;
      name: string;
      title: string;
      specialty: string;
      university: string;
      registrationNumber: string;
      signatureUrl: string | null;
    } | null = null;

    if (analystId) {
      analyst = await this.prisma.labSigner.findUnique({
        where: { id: analystId },
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
    }

    const formulaUpdates: { id: string; numericValue: number }[] = [];
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
          formulaUpdates.push({ id: a.id, numericValue: value });
          (a as { numericValue: typeof value }).numericValue = value;
        }
      }
    }
    if (formulaUpdates.length > 0) {
      await Promise.all(
        formulaUpdates.map((u) =>
          this.prisma.resultReportAnalyte.update({
            where: { id: u.id },
            data: { numericValue: u.numericValue },
          })
        )
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM result_reports WHERE id = ${reportId} FOR UPDATE`;

        const report = await tx.resultReport.findUniqueOrThrow({
          where: { id: reportId },
          select: { currentReleaseSequence: true, observations: true },
        });

        const staleCheck = await tx.resultReportTest.findMany({
          where: { id: { in: reportTestIds } },
          select: { id: true, status: true },
        });
        const alreadyReleased = staleCheck.filter(
          (t) => t.status === 'RELEASED'
        );
        if (alreadyReleased.length > 0) {
          throw new ConflictException({
            message:
              'One or more tests have already been released by another reviewer.',
            alreadyReleasedTestIds: alreadyReleased.map((t) => t.id),
          });
        }

        const newSequence = report.currentReleaseSequence + 1;

        const allOrderedTests = await tx.orderedTest.findMany({
          where: { orderId },
          select: { id: true, status: true },
        });

        const remainingNonTerminal = allOrderedTests.filter((ot) => {
          const isBeingReleased = reportTests.some(
            (rt) => rt.orderedTestId === ot.id
          );
          if (isBeingReleased) return false;
          return ot.status !== 'COMPLETED' && ot.status !== 'CANCELLED';
        });

        const releaseType: ReleaseType =
          remainingNonTerminal.length === 0 ? 'FINAL' : 'PARTIAL';

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
            analystId: analyst?.id ?? null,
            analystName: analyst?.name ?? null,
            analystTitle: analyst?.title || null,
            analystSpecialty: analyst?.specialty || null,
            analystUniversity: analyst?.university || null,
            analystRegistrationNumber: analyst?.registrationNumber || null,
            analystSignatureUrl: analyst?.signatureUrl ?? null,
            releasedByUserId: actorId,
            releasedByName: actorName,
            reviewNotes: reviewNotes ?? null,
            observations: observations ?? null,
            orderingVetId: order.orderingVetId ?? null,
            orderingVetName: order.orderingVetName ?? null,
            orderingVetLicenseNumber: order.orderingVetLicenseNumber ?? null,
            orderingVetIssuingAuthority:
              order.orderingVetIssuingAuthority ?? null,
            ...snapshots,
          },
        });

        const now = new Date();

        // Collect all analyte operations to batch them
        const allAnalyteUpdates: { id: string; flag: string | null; referenceSnapshot: Prisma.InputJsonValue }[] = [];
        const allReleaseAnalytes: {
          releaseTestId: string;
          code: string;
          name: string;
          sectionName: string | null;
          sortOrder: number;
          isHeader: boolean;
          valueType: string;
          numericValue: number | null;
          textValue: string | null;
          booleanValue: boolean | null;
          selectValue: string | null;
          unit: string | null;
          technique: string | null;
          formula: string | null;
          flag: string | null;
          referenceSnapshot: Prisma.InputJsonValue;
        }[] = [];

        for (const rt of reportTests) {
          const ot = order.orderedTests.find((t) => t.id === rt.orderedTestId);
          const specimens = ot?.specimens ?? [];

          const releaseTest = await tx.resultReportReleaseTest.create({
            data: {
              releaseId: release.id,
              sourceReportTestId: rt.id,
              orderedTestId: rt.orderedTestId,
              catalogItemCode: ot?.catalogItemCode ?? null,
              catalogItemName: ot?.catalogItemName ?? rt.templateVersion.title,
              department: ot?.department ?? null,
              processingMethod: ot?.processingMethod ?? null,
              entryMethod: ot?.entryMethod ?? 'MANUAL',
              templateDefinitionId: rt.templateDefinition.id,
              templateVersionId: rt.templateVersion.id,
              templateTitle: rt.templateVersion.title,
              templateVersion: rt.templateVersion.version,
              specimenAccessionNumbers: specimens.map(
                (s) => s.specimen.accessionNumber
              ),
              specimenTypes: specimens.map((s) => s.specimen.specimenType),
              observations: report.observations ?? null,
              testStartedAt: ot?.startedAt ?? null,
              testCompletedAt: now,
              resultsEnteredAt: ot?.completedAt ?? null,
            },
          });

          for (const a of rt.analytes) {
            const ref = a.templateAnalyte
              ?.referenceRange as ReferenceRangeSnapshot | null;
            const flag =
              a.valueType === 'NUMERIC' && a.numericValue != null
                ? this.computeFlag(ref, Number(a.numericValue))
                : null;

            allAnalyteUpdates.push({
              id: a.id,
              flag,
              referenceSnapshot:
                (ref as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            });

            allReleaseAnalytes.push({
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
            });
          }

          await tx.resultReportTest.update({
            where: { id: rt.id },
            data: {
              status: 'RELEASED',
              latestReleaseId: release.id,
              latestReleasedAt: now,
            },
          });

          if (rt.orderedTestId) {
            await tx.orderedTest.update({
              where: { id: rt.orderedTestId },
              data: {
                status: 'COMPLETED',
                completedAt: now,
                version: { increment: 1 },
              },
            });
          }
        }

        // Batch create all release analyte snapshots
        if (allReleaseAnalytes.length > 0) {
          await tx.resultReportReleaseAnalyte.createMany({
            data: allReleaseAnalytes as never,
          });
        }

        // Batch update analyte flags/references
        if (allAnalyteUpdates.length > 0) {
          await Promise.all(
            allAnalyteUpdates.map((u) =>
              tx.resultReportAnalyte.update({
                where: { id: u.id },
                data: {
                  flag: u.flag,
                  referenceSnapshot: u.referenceSnapshot,
                },
              })
            )
          );
        }

        const updatedTests = await tx.resultReportTest.findMany({
          where: { reportId },
          select: { status: true },
        });
        const allReleased = updatedTests.every((t) => t.status === 'RELEASED');
        const anyInReview = updatedTests.some((t) => t.status === 'IN_REVIEW');

        const reportStatus = allReleased
          ? 'RELEASED'
          : anyInReview
          ? 'IN_REVIEW'
          : 'DRAFT';

        await tx.resultReport.update({
          where: { id: reportId },
          data: {
            currentReleaseSequence: newSequence,
            status: reportStatus,
            ...(reportStatus === 'RELEASED' ? { releasedAt: now } : {}),
          },
        });

        await tx.resultReportReleaseArtifact.create({
          data: { releaseId: release.id, artifactType: 'PDF' },
        });

        await tx.timelineEvent.create({
          data: {
            orderId,
            eventType: 'RELEASE_CREATED',
            actorId,
            actorName,
            description: `${releaseType} release #${newSequence} approved by ${signer.name}`,
            metadata: {
              releaseId: release.id,
              releaseSequence: newSequence,
              releaseType,
              signerId: signer.id,
              signerName: signer.name,
              releasedTestIds: testIds,
            },
          },
        });

        await this.orderStatusService.deriveAndPersist(orderId, tx);

        const aggregateReportStatus = allReleased
          ? 'ALL_RELEASED'
          : 'PARTIAL_RESULTS';

        return {
          releaseId: release.id,
          releaseSequence: newSequence,
          releaseType,
          aggregateReportStatus,
          releasedTests: reportTests.map((rt) => ({
            reportTestId: rt.id,
            orderedTestId: rt.orderedTestId,
          })),
        };
      },
      { timeout: 30000 }
    );

    return result;
  }

  async getReleaseHistory(orderId: string, labTenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true, resultReport: { select: { id: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport)
      return {
        releases: [],
        aggregateReportStatus: 'PARTIAL_RESULTS' as const,
      };

    const releases = await this.prisma.resultReportRelease.findMany({
      where: { reportId: order.resultReport.id },
      include: {
        tests: {
          select: {
            catalogItemName: true,
            catalogItemCode: true,
            amendsReleaseTestId: true,
          },
        },
        artifacts: {
          where: { artifactType: 'PDF' },
          select: { status: true, storageUrl: true },
          take: 1,
        },
      },
      orderBy: { releaseSequence: 'asc' },
    });

    const reportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId: order.resultReport.id },
      select: { status: true },
    });
    const amendments = await this.prisma.resultReportAmendment.findMany({
      where: {
        reportId: order.resultReport.id,
        status: { in: ['DRAFT', 'IN_REVIEW'] },
      },
      select: { id: true },
    });

    let aggregateReportStatus: string;
    if (amendments.length > 0) {
      aggregateReportStatus = 'AMENDMENT_PENDING';
    } else if (reportTests.every((t) => t.status === 'RELEASED')) {
      aggregateReportStatus = 'ALL_RELEASED';
    } else {
      aggregateReportStatus = 'PARTIAL_RESULTS';
    }

    return {
      releases: releases.map((r) => ({
        id: r.id,
        releaseSequence: r.releaseSequence,
        releaseType: r.releaseType,
        signerName: r.signerName,
        releasedAt: r.releasedAt.toISOString(),
        pdfStatus: r.artifacts[0]?.status ?? 'PENDING',
        pdfUrl: r.artifacts[0]?.storageUrl ?? null,
        orderingVetId: r.orderingVetId ?? null,
        orderingVetName: r.orderingVetName ?? null,
        orderingVetLicenseNumber: r.orderingVetLicenseNumber ?? null,
        orderingVetIssuingAuthority: r.orderingVetIssuingAuthority ?? null,
        tests: r.tests.map((t) => ({
          catalogItemName: t.catalogItemName,
          catalogItemCode: t.catalogItemCode,
          amendsReleaseTestId: t.amendsReleaseTestId,
        })),
      })),
      aggregateReportStatus,
    };
  }

  async getCurrentResults(orderId: string, labTenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        requisitionNumber: true,
        resultReport: { select: { id: true } },
        case: {
          select: {
            patientName: true,
            patientSpecies: true,
            patientBreed: true,
            patientSex: true,
            patientAge: true,
            patientAgeUnit: true,
            patientWeight: true,
            ownerName: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport)
      return {
        orderId,
        requisitionNumber: order.requisitionNumber,
        patient: order.case,
        tests: [],
      };

    const reportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId: order.resultReport.id, status: 'RELEASED' },
      select: {
        id: true,
        latestReleaseId: true,
        orderedTestId: true,
      },
    });

    const releaseTestMap = new Map<string, string>();
    for (const rt of reportTests) {
      if (rt.latestReleaseId) {
        releaseTestMap.set(rt.id, rt.latestReleaseId);
      }
    }

    const releaseTests = await this.prisma.resultReportReleaseTest.findMany({
      where: {
        sourceReportTestId: { in: reportTests.map((rt) => rt.id) },
        releaseId: { in: Array.from(releaseTestMap.values()) },
      },
      include: {
        analytes: { orderBy: { sortOrder: 'asc' } },
        release: {
          select: {
            releaseSequence: true,
            releaseType: true,
            releasedAt: true,
            signerName: true,
            orderingVetId: true,
            orderingVetName: true,
            orderingVetLicenseNumber: true,
            orderingVetIssuingAuthority: true,
          },
        },
      },
    });

    const latestByTest = new Map<string, (typeof releaseTests)[0]>();
    for (const rt of releaseTests) {
      if (releaseTestMap.get(rt.sourceReportTestId) === rt.releaseId) {
        latestByTest.set(rt.sourceReportTestId, rt);
      }
    }

    return {
      orderId,
      requisitionNumber: order.requisitionNumber,
      patient: order.case,
      tests: Array.from(latestByTest.values()).map((rt) => ({
        catalogItemName: rt.catalogItemName,
        catalogItemCode: rt.catalogItemCode,
        releaseId: rt.releaseId,
        releaseSequence: rt.release.releaseSequence,
        releaseType: rt.release.releaseType,
        releasedAt: rt.release.releasedAt.toISOString(),
        signerName: rt.release.signerName,
        orderingVetId: rt.release.orderingVetId ?? null,
        orderingVetName: rt.release.orderingVetName ?? null,
        orderingVetLicenseNumber: rt.release.orderingVetLicenseNumber ?? null,
        orderingVetIssuingAuthority:
          rt.release.orderingVetIssuingAuthority ?? null,
        analytes: rt.analytes.map((a) => ({
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
          flag: a.flag,
          referenceSnapshot: a.referenceSnapshot,
        })),
      })),
    };
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
      reportDisclaimer: null as string | null,
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
          reportDisclaimer: true,
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
        reportDisclaimer: labProfile?.reportDisclaimer ?? null,
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
