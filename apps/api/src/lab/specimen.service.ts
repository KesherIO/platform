import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { OrderStatusService } from './order-status.service';
import type { AccessionOrderDto } from './dto/accession-order.dto';
import type { AgeUnit, PatientSpecies, Prisma } from '@prisma/client';

const CONDITION_FLAG_LABELS: Record<string, string> = {
  isHemolyzed: 'hemolyzed',
  isLipemic: 'lipemic',
  isIcteric: 'icteric',
  isInsufficient: 'insufficient volume',
  isContaminated: 'contaminated',
  isWrongContainer: 'wrong container',
  isLeaking: 'leaking',
};

function buildConditionFlags(s: {
  isHemolyzed?: boolean;
  isLipemic?: boolean;
  isIcteric?: boolean;
  isInsufficient?: boolean;
  isContaminated?: boolean;
  isWrongContainer?: boolean;
  isLeaking?: boolean;
}): string[] {
  return Object.entries(CONDITION_FLAG_LABELS)
    .filter(([key]) => s[key as keyof typeof s])
    .map(([, label]) => label);
}

function buildRejectionReason(s: {
  rejectionReason?: string;
  isHemolyzed?: boolean;
  isLipemic?: boolean;
  isIcteric?: boolean;
  isInsufficient?: boolean;
  isContaminated?: boolean;
  isWrongContainer?: boolean;
  isLeaking?: boolean;
}): string {
  const flags = buildConditionFlags(s);
  if (s.rejectionReason && flags.length)
    return `${s.rejectionReason} (${flags.join(', ')})`;
  if (s.rejectionReason) return s.rejectionReason;
  if (flags.length) return flags.join(', ');
  return 'no reason';
}

function ageToWeeks(age: number, unit: AgeUnit): number {
  switch (unit) {
    case 'DAYS':
      return age / 7;
    case 'WEEKS':
      return age;
    case 'MONTHS':
      return age * 4.33;
    case 'YEARS':
      return age * 52;
    default:
      return age;
  }
}

@Injectable()
export class SpecimenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateVersionService: TemplateVersionService,
    private readonly orderStatusService: OrderStatusService
  ) {}

  // ---------------------------------------------------------------------------
  // Derive expected specimens from LabTestSpecimenRequirement
  // ---------------------------------------------------------------------------

  async getExpectedSpecimens(orderId: string, labTenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        orderedTests: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            id: true,
            catalogItemId: true,
            catalogItemCode: true,
            catalogItemName: true,
            status: true,
            catalogItem: {
              select: {
                labTestConfigurations: {
                  where: { labTenantId },
                  select: {
                    department: true,
                    specimenRequirements: {
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                  take: 1,
                },
              },
            },
          },
        },
        specimens: {
          orderBy: [{ specimenType: 'asc' }, { tubeIndex: 'asc' }],
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');

    // Group tests by their primary (specimenType, containerType) requirement
    const specimenGroups = new Map<
      string,
      {
        specimenType: string;
        containerType: string;
        tests: { id: string; name: string; code: string | null }[];
        minimumVolumeMl: number | null;
      }
    >();

    const unconfiguredTests: {
      id: string;
      name: string;
      code: string | null;
    }[] = [];

    for (const test of order.orderedTests) {
      const config = test.catalogItem?.labTestConfigurations[0];
      const primaryReq = config?.specimenRequirements.find(
        (r) => !r.isAlternativeWithinGroup
      );

      if (!primaryReq) {
        unconfiguredTests.push({
          id: test.id,
          name: test.catalogItemName,
          code: test.catalogItemCode,
        });
        continue;
      }

      const key = `${primaryReq.specimenType}::${primaryReq.containerType}`;
      const group = specimenGroups.get(key) ?? {
        specimenType: primaryReq.specimenType,
        containerType: primaryReq.containerType,
        tests: [],
        minimumVolumeMl: primaryReq.minimumVolumeMl,
      };
      group.tests.push({
        id: test.id,
        name: test.catalogItemName,
        code: test.catalogItemCode,
      });
      if (
        primaryReq.minimumVolumeMl !== null &&
        (group.minimumVolumeMl === null ||
          primaryReq.minimumVolumeMl > group.minimumVolumeMl)
      ) {
        group.minimumVolumeMl = primaryReq.minimumVolumeMl;
      }
      specimenGroups.set(key, group);
    }

    return {
      expectedSpecimenGroups: Array.from(specimenGroups.values()),
      unconfiguredTests,
      existingSpecimens: order.specimens,
    };
  }

  // ---------------------------------------------------------------------------
  // Accession an order — create/update specimens, link tests, transition statuses
  // ---------------------------------------------------------------------------

  async accessionOrder(
    orderId: string,
    labTenantId: string,
    dto: AccessionOrderDto,
    actorId: string,
    actorName: string
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        status: true,
        case: {
          select: {
            patientSpecies: true,
            patientAge: true,
            patientAgeUnit: true,
          },
        },
        orderedTests: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            id: true,
            catalogItemId: true,
            catalogItemCode: true,
            catalogItemName: true,
            status: true,
            catalogItem: {
              select: {
                code: true,
                labTestConfigurations: {
                  where: { labTenantId },
                  select: {
                    department: true,
                    defaultProcessingMethod: true,
                    defaultAnalyzerId: true,
                    specimenRequirements: {
                      orderBy: { sortOrder: 'asc' },
                    },
                  },
                  take: 1,
                },
              },
            },
          },
        },
        specimens: {
          select: {
            id: true,
            specimenType: true,
            containerType: true,
            tubeIndex: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const patientSpecies = order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      order.case.patientAge && order.case.patientAgeUnit
        ? ageToWeeks(
            order.case.patientAge,
            order.case.patientAgeUnit as AgeUnit
          )
        : null;

    // Generate accession numbers for specimens that don't have one
    const year = new Date().getFullYear();
    const needsAccession = dto.specimens.some((s) => !s.accessionNumber);
    const baseCount = needsAccession
      ? await this.prisma.specimen.count({ where: { labTenantId } })
      : 0;
    let accessionOffset = 0;
    const specimenData = dto.specimens.map((s) => {
      let accessionNumber = s.accessionNumber;
      if (!accessionNumber) {
        accessionOffset++;
        accessionNumber = `SPEC-${year}-${String(
          baseCount + accessionOffset
        ).padStart(6, '0')}`;
      }
      return { ...s, accessionNumber };
    });

    const now = new Date();

    // Pre-resolve templates for all unique catalog codes (avoids N+1 inside transaction)
    const uniqueCodes = new Set<string>();
    for (const test of order.orderedTests) {
      uniqueCodes.add(test.catalogItem?.code ?? test.catalogItemCode ?? '');
    }
    const templateCache = new Map<
      string,
      Awaited<ReturnType<typeof this.templateVersionService.resolveTemplate>>
    >();
    await Promise.all(
      Array.from(uniqueCodes).map(async (code) => {
        const tmpl = await this.templateVersionService.resolveTemplate(
          code,
          labTenantId,
          patientSpecies,
          ageWeeks
        );
        templateCache.set(code, tmpl);
      })
    );

    // Create / update specimens and link tests in a transaction
    const result = await this.prisma.$transaction(
      async (tx) => {
        const timelineEvents: Prisma.TimelineEventCreateManyInput[] = [];

        // --- Specimens: parallel create/update ---
        const createdSpecimens = await Promise.all(
          specimenData.map(async (s) => {
            const tubeIndex = s.tubeIndex ?? 1;

            const existing = order.specimens.find(
              (sp) =>
                sp.specimenType === s.specimenType &&
                sp.containerType === s.containerType &&
                sp.tubeIndex === tubeIndex
            );

            const specimenStatus = s.accepted ? 'ACCEPTED' : 'REJECTED';
            const conditionData = {
              isHemolyzed: s.isHemolyzed ?? false,
              isLipemic: s.isLipemic ?? false,
              isIcteric: s.isIcteric ?? false,
              isInsufficient: s.isInsufficient ?? false,
              isContaminated: s.isContaminated ?? false,
              isWrongContainer: s.isWrongContainer ?? false,
              isLeaking: s.isLeaking ?? false,
            };

            const specimen = existing
              ? await tx.specimen.update({
                  where: { id: existing.id },
                  data: {
                    status: specimenStatus,
                    ...conditionData,
                    rejectionReason: s.accepted
                      ? null
                      : s.rejectionReason ?? null,
                    notes: s.notes ?? null,
                    receivedAt: now,
                    receivedById: actorId,
                  },
                })
              : await tx.specimen.create({
                  data: {
                    orderId,
                    labTenantId,
                    accessionNumber: s.accessionNumber!,
                    specimenType: s.specimenType,
                    containerType: s.containerType,
                    tubeIndex,
                    status: specimenStatus,
                    ...conditionData,
                    rejectionReason: s.accepted
                      ? null
                      : s.rejectionReason ?? null,
                    notes: s.notes ?? null,
                    receivedAt: now,
                    receivedById: actorId,
                  },
                });

            timelineEvents.push({
              orderId,
              eventType: s.accepted ? 'SAMPLE_ACCEPTED' : 'SAMPLE_REJECTED',
              actorId,
              actorName,
              description: s.accepted
                ? `Specimen ${s.accessionNumber} (${s.specimenType}) accepted`
                : `Specimen ${s.accessionNumber} (${
                    s.specimenType
                  }) rejected: ${buildRejectionReason(s)}`,
              metadata: {
                specimenId: specimen.id,
                accessionNumber: s.accessionNumber,
                specimenType: s.specimenType,
                reason: s.rejectionReason,
                conditions: buildConditionFlags(s),
              },
            });

            return {
              id: specimen.id,
              accepted: s.accepted,
              specimenType: s.specimenType,
              containerType: s.containerType,
              tubeIndex,
            };
          })
        );

        // --- Tests: parallel link + status transition ---
        await Promise.all(
          order.orderedTests.map(async (test) => {
            const config = test.catalogItem?.labTestConfigurations[0];
            const primaryReq = config?.specimenRequirements.find(
              (r) => !r.isAlternativeWithinGroup
            );

            const matchingAccepted = createdSpecimens.find(
              (sp) =>
                sp.accepted &&
                (!primaryReq ||
                  (sp.specimenType === primaryReq.specimenType &&
                    sp.containerType === primaryReq.containerType))
            );

            const matchingRejected =
              !matchingAccepted &&
              createdSpecimens.find(
                (sp) =>
                  !sp.accepted &&
                  (!primaryReq ||
                    (sp.specimenType === primaryReq.specimenType &&
                      sp.containerType === primaryReq.containerType))
              );

            if (matchingAccepted) {
              const catalogCode =
                test.catalogItem?.code ?? test.catalogItemCode ?? '';
              const templateDef = templateCache.get(catalogCode) ?? null;

              const upsertPromise = tx.orderedTestSpecimen.upsert({
                where: {
                  orderedTestId_specimenId: {
                    orderedTestId: test.id,
                    specimenId: matchingAccepted.id,
                  },
                },
                create: {
                  orderedTestId: test.id,
                  specimenId: matchingAccepted.id,
                },
                update: {},
              });

              if (templateDef?.activeVersionId) {
                const updatePromise = tx.orderedTest.update({
                  where: { id: test.id },
                  data: {
                    status: 'READY',
                    department: config?.department ?? null,
                    processingMethod: config?.defaultProcessingMethod ?? null,
                    analyzerId: config?.defaultAnalyzerId ?? null,
                    version: { increment: 1 },
                  },
                });
                await Promise.all([upsertPromise, updatePromise]);
                timelineEvents.push({
                  orderId,
                  eventType: 'TEMPLATE_RESOLVED',
                  actorId,
                  actorName,
                  description: `Template resolved for ${test.catalogItemName}`,
                  metadata: {
                    orderedTestId: test.id,
                    templateDefinitionId: templateDef.id,
                    templateVersionId: templateDef.activeVersionId,
                  },
                });
              } else {
                const updatePromise = tx.orderedTest.update({
                  where: { id: test.id },
                  data: {
                    status: 'BLOCKED',
                    blockReason: 'MISSING_RESULT_TEMPLATE',
                    blockReasonDetail: `No published template for ${catalogCode} + ${patientSpecies}`,
                    version: { increment: 1 },
                  },
                });
                await Promise.all([upsertPromise, updatePromise]);
                timelineEvents.push({
                  orderId,
                  eventType: 'TEST_BLOCKED',
                  actorId,
                  actorName,
                  description: `${test.catalogItemName} blocked: no result template`,
                  metadata: {
                    orderedTestId: test.id,
                    blockReason: 'MISSING_RESULT_TEMPLATE',
                    catalogCode,
                    species: patientSpecies,
                  },
                });
              }
            } else if (matchingRejected) {
              await tx.orderedTest.update({
                where: { id: test.id },
                data: {
                  status: 'BLOCKED',
                  blockReason: 'REJECTED_SPECIMEN',
                  blockReasonDetail: `Specimen rejected: ${matchingRejected.specimenType}`,
                  version: { increment: 1 },
                },
              });
              timelineEvents.push({
                orderId,
                eventType: 'TEST_BLOCKED',
                actorId,
                actorName,
                description: `${test.catalogItemName} blocked: specimen rejected`,
                metadata: {
                  orderedTestId: test.id,
                  blockReason: 'REJECTED_SPECIMEN',
                },
              });
            } else if (!primaryReq) {
              const catalogCode =
                test.catalogItem?.code ?? test.catalogItemCode ?? '';
              const templateDef = templateCache.get(catalogCode) ?? null;

              if (templateDef?.activeVersionId) {
                await tx.orderedTest.update({
                  where: { id: test.id },
                  data: { status: 'READY', version: { increment: 1 } },
                });
                timelineEvents.push({
                  orderId,
                  eventType: 'TEMPLATE_RESOLVED',
                  actorId,
                  actorName,
                  description: `Template resolved for ${test.catalogItemName}`,
                  metadata: {
                    orderedTestId: test.id,
                    templateDefinitionId: templateDef.id,
                    templateVersionId: templateDef.activeVersionId,
                  },
                });
              } else {
                await tx.orderedTest.update({
                  where: { id: test.id },
                  data: {
                    status: 'BLOCKED',
                    blockReason: 'MISSING_RESULT_TEMPLATE',
                    blockReasonDetail: `No published template for ${catalogCode} + ${patientSpecies}`,
                    version: { increment: 1 },
                  },
                });
                timelineEvents.push({
                  orderId,
                  eventType: 'TEST_BLOCKED',
                  actorId,
                  actorName,
                  description: `${test.catalogItemName} blocked: no result template`,
                  metadata: {
                    orderedTestId: test.id,
                    blockReason: 'MISSING_RESULT_TEMPLATE',
                    catalogCode,
                    species: patientSpecies,
                  },
                });
              }
            }
          })
        );

        // Overall accessioning event
        timelineEvents.push({
          orderId,
          eventType: 'SAMPLE_ACCESSIONED',
          actorId,
          actorName,
          description: `Order accessioned — ${
            createdSpecimens.filter((s) => s.accepted).length
          } specimen(s) accepted`,
          metadata: {
            totalSpecimens: createdSpecimens.length,
            accepted: createdSpecimens.filter((s) => s.accepted).length,
            rejected: createdSpecimens.filter((s) => !s.accepted).length,
          },
        });

        // Batch: stamp receivedAt + all timeline events in parallel
        await Promise.all([
          tx.orderedTest.updateMany({
            where: { orderId, receivedAt: null },
            data: { receivedAt: now },
          }),
          tx.timelineEvent.createMany({ data: timelineEvents }),
        ]);

        return createdSpecimens;
      },
      { timeout: 30000 }
    );

    // Derive and persist order status after transaction
    const { orderStatus } = await this.orderStatusService.deriveAndPersist(
      orderId
    );

    return {
      specimens: result,
      order: { id: orderId, status: orderStatus },
    };
  }

  // ---------------------------------------------------------------------------
  // Update a single specimen (condition flags, accept/reject)
  // ---------------------------------------------------------------------------

  async updateSpecimen(
    specimenId: string,
    labTenantId: string,
    data: {
      status?: 'ACCEPTED' | 'REJECTED';
      rejectionReason?: string;
      notes?: string;
      isHemolyzed?: boolean;
      isLipemic?: boolean;
      isIcteric?: boolean;
      isInsufficient?: boolean;
      isContaminated?: boolean;
      isWrongContainer?: boolean;
      isLeaking?: boolean;
    },
    actorId: string,
    actorName: string
  ) {
    const specimen = await this.prisma.specimen.findFirst({
      where: { id: specimenId, labTenantId },
      select: {
        id: true,
        orderId: true,
        specimenType: true,
        accessionNumber: true,
      },
    });
    if (!specimen) throw new NotFoundException('Specimen not found.');

    if (data.status === 'REJECTED' && !data.rejectionReason) {
      throw new BadRequestException(
        'rejectionReason is required when rejecting a specimen.'
      );
    }

    const updated = await this.prisma.specimen.update({
      where: { id: specimenId },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.rejectionReason !== undefined && {
          rejectionReason: data.rejectionReason,
        }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.isHemolyzed !== undefined && {
          isHemolyzed: data.isHemolyzed,
        }),
        ...(data.isLipemic !== undefined && { isLipemic: data.isLipemic }),
        ...(data.isIcteric !== undefined && { isIcteric: data.isIcteric }),
        ...(data.isInsufficient !== undefined && {
          isInsufficient: data.isInsufficient,
        }),
        ...(data.isContaminated !== undefined && {
          isContaminated: data.isContaminated,
        }),
        ...(data.isWrongContainer !== undefined && {
          isWrongContainer: data.isWrongContainer,
        }),
        ...(data.isLeaking !== undefined && { isLeaking: data.isLeaking }),
      },
    });

    if (data.status) {
      await this.prisma.timelineEvent.create({
        data: {
          orderId: specimen.orderId,
          eventType:
            data.status === 'ACCEPTED' ? 'SAMPLE_ACCEPTED' : 'SAMPLE_REJECTED',
          actorId,
          actorName,
          description: `Specimen ${specimen.accessionNumber} (${
            specimen.specimenType
          }) ${data.status.toLowerCase()}`,
          metadata: { specimenId, reason: data.rejectionReason },
        },
      });
    }

    await this.orderStatusService.deriveAndPersist(specimen.orderId);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Retry template resolution for a BLOCKED test
  // ---------------------------------------------------------------------------

  async resolveTemplateForBlockedTest(
    orderedTestId: string,
    labTenantId: string,
    actorId: string,
    actorName: string
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: {
        id: orderedTestId,
        status: 'BLOCKED',
        blockReason: 'MISSING_RESULT_TEMPLATE',
        order: { labTenantId },
      },
      select: {
        id: true,
        catalogItemCode: true,
        catalogItemName: true,
        orderId: true,
        order: {
          select: {
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
          },
        },
        catalogItem: { select: { code: true } },
      },
    });
    if (!test) {
      throw new NotFoundException(
        'Ordered test not found or not in BLOCKED (MISSING_RESULT_TEMPLATE) state.'
      );
    }

    const patientSpecies = test.order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      test.order.case.patientAge && test.order.case.patientAgeUnit
        ? ageToWeeks(
            test.order.case.patientAge,
            test.order.case.patientAgeUnit as AgeUnit
          )
        : null;

    const catalogCode = test.catalogItem?.code ?? test.catalogItemCode ?? '';
    const templateDef = await this.templateVersionService.resolveTemplate(
      catalogCode,
      labTenantId,
      patientSpecies,
      ageWeeks
    );

    if (!templateDef?.activeVersionId) {
      return { resolved: false, test: { id: test.id, status: 'BLOCKED' } };
    }

    await this.prisma.$transaction([
      this.prisma.orderedTest.update({
        where: { id: orderedTestId },
        data: {
          status: 'READY',
          blockReason: null,
          blockReasonDetail: null,
          version: { increment: 1 },
        },
      }),
      this.prisma.timelineEvent.create({
        data: {
          orderId: test.orderId,
          eventType: 'TEMPLATE_RESOLVED',
          actorId,
          actorName,
          description: `Template resolved for ${test.catalogItemName} — test unblocked`,
          metadata: {
            orderedTestId,
            templateDefinitionId: templateDef.id,
            templateVersionId: templateDef.activeVersionId,
          },
        },
      }),
    ]);

    await this.orderStatusService.deriveAndPersist(test.orderId);
    return { resolved: true, test: { id: test.id, status: 'READY' } };
  }

  // ---------------------------------------------------------------------------
  // Manually assign a template to a BLOCKED (MISSING_RESULT_TEMPLATE) test
  // ---------------------------------------------------------------------------

  async assignTemplateToBlockedTest(
    orderedTestId: string,
    templateVersionId: string,
    labTenantId: string,
    actorId: string,
    actorName: string
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: {
        id: orderedTestId,
        status: 'BLOCKED',
        blockReason: 'MISSING_RESULT_TEMPLATE',
        order: { labTenantId },
      },
      select: { id: true, catalogItemName: true, orderId: true },
    });
    if (!test) {
      throw new NotFoundException(
        'Ordered test not found or not in BLOCKED (MISSING_RESULT_TEMPLATE) state.'
      );
    }

    const version = await this.prisma.resultTemplateVersion.findFirst({
      where: { id: templateVersionId, status: 'PUBLISHED' },
      select: { id: true, definitionId: true },
    });
    if (!version) {
      throw new NotFoundException(
        'Template version not found or not published.'
      );
    }

    await this.prisma.$transaction([
      this.prisma.orderedTest.update({
        where: { id: orderedTestId },
        data: {
          status: 'READY',
          blockReason: null,
          blockReasonDetail: null,
          version: { increment: 1 },
        },
      }),
      this.prisma.timelineEvent.create({
        data: {
          orderId: test.orderId,
          eventType: 'TEMPLATE_RESOLVED',
          actorId,
          actorName,
          description: `Template manually assigned for ${test.catalogItemName} — test unblocked`,
          metadata: { orderedTestId, templateVersionId },
        },
      }),
    ]);

    await this.orderStatusService.deriveAndPersist(test.orderId);
    return { resolved: true, test: { id: test.id, status: 'READY' } };
  }

  // ---------------------------------------------------------------------------
  // Mark a specimen as MISSING
  // ---------------------------------------------------------------------------

  async markMissing(
    orderId: string,
    specimenId: string,
    labTenantId: string,
    dto: { reason: string; confirm: boolean },
    actorId: string,
    actorName: string
  ) {
    if (!dto.confirm) {
      throw new BadRequestException('Confirmation required.');
    }

    const specimen = await this.prisma.specimen.findFirst({
      where: { id: specimenId, orderId, labTenantId },
      select: {
        id: true,
        orderId: true,
        status: true,
        accessionNumber: true,
        specimenType: true,
      },
    });
    if (!specimen) throw new NotFoundException('Specimen not found.');

    const allowedStatuses = new Set(['EXPECTED', 'RECEIVED']);
    if (!allowedStatuses.has(specimen.status)) {
      throw new BadRequestException(
        `Cannot mark specimen as missing from status ${specimen.status}. Only EXPECTED or RECEIVED specimens can be marked missing.`
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.specimen.update({
          where: { id: specimenId },
          data: {
            status: 'MISSING',
            markedMissingAt: new Date(),
            markedMissingById: actorId,
          },
        });

        const linkedTests = await tx.orderedTestSpecimen.findMany({
          where: { specimenId },
          select: {
            orderedTest: { select: { id: true, status: true } },
          },
        });

        const blockableStatuses = new Set(['PENDING', 'READY']);
        const blockedTestIds: string[] = [];

        for (const link of linkedTests) {
          if (blockableStatuses.has(link.orderedTest.status)) {
            await tx.orderedTest.update({
              where: { id: link.orderedTest.id },
              data: {
                status: 'BLOCKED',
                blockReason: 'MISSING_SPECIMEN',
                blockReasonDetail: `Specimen ${specimen.accessionNumber} (${specimen.specimenType}) marked missing`,
                version: { increment: 1 },
              },
            });
            blockedTestIds.push(link.orderedTest.id);

            await tx.timelineEvent.create({
              data: {
                orderId,
                eventType: 'TEST_BLOCKED',
                actorId,
                actorName,
                description: `Test blocked: specimen ${specimen.accessionNumber} marked missing`,
                metadata: {
                  orderedTestId: link.orderedTest.id,
                  blockReason: 'MISSING_SPECIMEN',
                  specimenId,
                },
              },
            });
          }
        }

        await tx.timelineEvent.create({
          data: {
            orderId,
            eventType: 'SPECIMEN_MISSING',
            actorId,
            actorName,
            description: `Specimen ${specimen.accessionNumber} (${specimen.specimenType}) marked as missing`,
            metadata: {
              specimenId,
              accessionNumber: specimen.accessionNumber,
              specimenType: specimen.specimenType,
              blockedTestIds,
              reason: dto.reason,
            },
          },
        });
      },
      { timeout: 15000 }
    );

    await this.orderStatusService.deriveAndPersist(orderId);

    return this.prisma.specimen.findUnique({ where: { id: specimenId } });
  }

  // ---------------------------------------------------------------------------
  // Reverse a MISSING specimen back to EXPECTED
  // ---------------------------------------------------------------------------

  async reverseMissing(
    orderId: string,
    specimenId: string,
    labTenantId: string,
    dto: { reason?: string; confirm: boolean },
    actorId: string,
    actorName: string
  ) {
    if (!dto.confirm) {
      throw new BadRequestException('Confirmation required.');
    }

    const specimen = await this.prisma.specimen.findFirst({
      where: { id: specimenId, orderId, labTenantId },
      select: {
        id: true,
        orderId: true,
        status: true,
        accessionNumber: true,
        specimenType: true,
      },
    });
    if (!specimen) throw new NotFoundException('Specimen not found.');

    if (specimen.status !== 'MISSING') {
      throw new BadRequestException(
        `Cannot reverse: specimen is ${specimen.status}, not MISSING.`
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.specimen.update({
          where: { id: specimenId },
          data: {
            status: 'EXPECTED',
            markedMissingAt: null,
            markedMissingById: null,
          },
        });

        const linkedTests = await tx.orderedTestSpecimen.findMany({
          where: { specimenId },
          select: {
            orderedTest: {
              select: {
                id: true,
                status: true,
                blockReason: true,
                blockReasonDetail: true,
                specimens: {
                  select: {
                    specimen: {
                      select: { id: true, status: true, accessionNumber: true },
                    },
                  },
                },
                reportTests: { select: { id: true }, take: 1 },
              },
            },
          },
        });

        const restoredTestIds: string[] = [];
        for (const link of linkedTests) {
          const test = link.orderedTest;
          if (
            test.status !== 'BLOCKED' ||
            test.blockReason !== 'MISSING_SPECIMEN'
          ) {
            continue;
          }

          if (
            test.blockReasonDetail &&
            !test.blockReasonDetail.includes(specimen.accessionNumber)
          ) {
            continue;
          }

          const otherProblems = test.specimens.filter(
            (s) =>
              s.specimen.id !== specimenId &&
              (s.specimen.status === 'MISSING' ||
                s.specimen.status === 'REJECTED')
          );

          if (otherProblems.length > 0) {
            const prob = otherProblems[0].specimen;
            await tx.orderedTest.update({
              where: { id: test.id },
              data: {
                blockReasonDetail: `Specimen ${prob.accessionNumber} still ${prob.status}`,
                version: { increment: 1 },
              },
            });
            continue;
          }

          const targetStatus =
            test.reportTests.length > 0 ? 'READY' : 'PENDING';
          await tx.orderedTest.update({
            where: { id: test.id },
            data: {
              status: targetStatus,
              blockReason: null,
              blockReasonDetail: null,
              version: { increment: 1 },
            },
          });
          restoredTestIds.push(test.id);
        }

        await tx.timelineEvent.create({
          data: {
            orderId,
            eventType: 'SPECIMEN_MISSING_REVERSED',
            actorId,
            actorName,
            description: `Missing status reversed for specimen ${specimen.accessionNumber} (${specimen.specimenType})`,
            metadata: {
              specimenId,
              accessionNumber: specimen.accessionNumber,
              specimenType: specimen.specimenType,
              reason: dto.reason ?? null,
              restoredTestIds,
            },
          },
        });

        for (const testId of restoredTestIds) {
          await tx.timelineEvent.create({
            data: {
              orderId,
              eventType: 'TEST_UNBLOCKED',
              actorId,
              actorName,
              description: `Test unblocked: specimen ${specimen.accessionNumber} missing status reversed`,
              metadata: {
                orderedTestId: testId,
                previousBlockReason: 'MISSING_SPECIMEN',
              },
            },
          });
        }
      },
      { timeout: 15000 }
    );

    await this.orderStatusService.deriveAndPersist(orderId);

    return this.prisma.specimen.findUnique({ where: { id: specimenId } });
  }
}
