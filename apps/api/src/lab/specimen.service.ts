import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { OrderStatusService } from './order-status.service';
import type { AccessionOrderDto } from './dto/accession-order.dto';
import type {
  ReceiveSpecimenDto,
  RequestSampleDto,
} from './dto/receive-specimen.dto';
import { NotificationService } from '../notifications/notification.service';
import { clinicOrderRecipients } from '../notifications/clinic-recipients';
import { createRequestedTube } from './requested-tube.util';
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

export function ageToWeeks(age: number, unit: AgeUnit): number {
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

/** Block reasons for which the clinic can be asked for another tube. */
const SAMPLE_BLOCK_REASONS = [
  'MISSING_SPECIMEN',
  'REJECTED_SPECIMEN',
  'INSUFFICIENT_VOLUME',
  'REQUIRES_RECOLLECTION',
] as const;

/** Ordered tests accessioning may (re)link to a tube and move to READY/BLOCKED. */
const ACCESSIONABLE_TESTS = {
  OR: [
    { status: 'PENDING' },
    {
      status: 'BLOCKED',
      blockReason: {
        in: [
          'MISSING_SPECIMEN',
          'REJECTED_SPECIMEN',
          'INSUFFICIENT_VOLUME',
          'REQUIRES_RECOLLECTION',
          'MISSING_RESULT_TEMPLATE',
        ],
      },
    },
  ],
} satisfies Prisma.OrderedTestWhereInput;

@Injectable()
export class SpecimenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateVersionService: TemplateVersionService,
    private readonly orderStatusService: OrderStatusService,
    private readonly notifications: NotificationService
  ) {}

  // ---------------------------------------------------------------------------
  // Derive expected specimens from LabTestSpecimenRequirement
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Receive one awaited (or missing) tube — never touches other tubes or tests
  // ---------------------------------------------------------------------------

  async receiveSpecimen(
    specimenId: string,
    labTenantId: string,
    dto: ReceiveSpecimenDto,
    actorId: string,
    actorName: string
  ) {
    const specimen = await this.prisma.specimen.findFirst({
      where: { id: specimenId, labTenantId },
      select: {
        id: true,
        orderId: true,
        status: true,
        specimenType: true,
        accessionNumber: true,
        order: {
          select: {
            status: true,
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
          },
        },
        orderedTests: {
          select: {
            orderedTest: {
              select: {
                id: true,
                status: true,
                blockReason: true,
                receivedAt: true,
                catalogItemCode: true,
                catalogItemName: true,
                templateDefinitionId: true,
                catalogItem: {
                  select: {
                    code: true,
                    labTestConfigurations: {
                      where: { labTenantId },
                      select: {
                        department: true,
                        defaultProcessingMethod: true,
                        defaultAnalyzerId: true,
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!specimen) throw new NotFoundException('Specimen not found.');
    if (specimen.status !== 'EXPECTED' && specimen.status !== 'MISSING') {
      throw new BadRequestException(
        `Only a tube still awaited or missing can be received (this one is ${specimen.status}).`
      );
    }
    if (['COMPLETED', 'CANCELLED'].includes(specimen.order.status)) {
      throw new BadRequestException(
        `The order is ${specimen.order.status}; nothing is waiting for this tube.`
      );
    }
    if (
      !dto.accepted &&
      !dto.rejectionReason &&
      buildConditionFlags(dto).length === 0
    ) {
      throw new BadRequestException(
        'A reason or a condition is required to reject a tube.'
      );
    }

    // Only the tests waiting for this tube move
    const waiting = specimen.orderedTests
      .map((l) => l.orderedTest)
      .filter(
        (t) =>
          t.status === 'PENDING' ||
          (t.status === 'BLOCKED' && t.blockReason === 'MISSING_SPECIMEN')
      );

    const species = specimen.order.case.patientSpecies as PatientSpecies;
    const { patientAge, patientAgeUnit } = specimen.order.case;
    const ageWeeks =
      patientAge && patientAgeUnit
        ? ageToWeeks(patientAge, patientAgeUnit as AgeUnit)
        : null;
    const templates = dto.accepted
      ? await Promise.all(
          waiting.map((t) =>
            this.templateVersionService.resolveTemplateForTest(
              {
                catalogItemCode: t.catalogItem?.code ?? t.catalogItemCode,
                templateDefinitionId: t.templateDefinitionId,
              },
              labTenantId,
              species,
              ageWeeks
            )
          )
        )
      : [];

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.specimen.update({
        where: { id: specimenId },
        data: {
          status: dto.accepted ? 'ACCEPTED' : 'REJECTED',
          accessionNumber: dto.accessionNumber ?? specimen.accessionNumber,
          isHemolyzed: dto.isHemolyzed ?? false,
          isLipemic: dto.isLipemic ?? false,
          isIcteric: dto.isIcteric ?? false,
          isInsufficient: dto.isInsufficient ?? false,
          isContaminated: dto.isContaminated ?? false,
          isWrongContainer: dto.isWrongContainer ?? false,
          isLeaking: dto.isLeaking ?? false,
          rejectionReason: dto.accepted ? null : dto.rejectionReason ?? null,
          notes: dto.notes ?? null,
          receivedAt: now,
          receivedById: actorId,
        },
      });

      const events: Prisma.TimelineEventCreateManyInput[] = [
        {
          orderId: specimen.orderId,
          eventType: dto.accepted ? 'SAMPLE_ACCEPTED' : 'SAMPLE_REJECTED',
          actorId,
          actorName,
          description: dto.accepted
            ? `Specimen ${updated.accessionNumber} (${specimen.specimenType}) accepted`
            : `Specimen ${updated.accessionNumber} (${
                specimen.specimenType
              }) rejected: ${buildRejectionReason(dto)}`,
          metadata: {
            specimenId,
            accessionNumber: updated.accessionNumber,
            specimenType: specimen.specimenType,
            reason: dto.rejectionReason,
            conditions: buildConditionFlags(dto),
          },
        },
      ];

      const tests: { id: string; status: string }[] = [];
      for (const [i, test] of waiting.entries()) {
        const template = templates[i];
        const config = test.catalogItem?.labTestConfigurations[0];
        const receivedAt = test.receivedAt ? {} : { receivedAt: now };
        if (!dto.accepted) {
          await tx.orderedTest.update({
            where: { id: test.id },
            data: {
              status: 'BLOCKED',
              blockReason: 'REJECTED_SPECIMEN',
              blockReasonDetail: `Specimen rejected: ${specimen.specimenType}`,
              version: { increment: 1 },
              ...receivedAt,
            },
          });
          tests.push({ id: test.id, status: 'BLOCKED' });
          events.push({
            orderId: specimen.orderId,
            eventType: 'TEST_BLOCKED',
            actorId,
            actorName,
            description: `${test.catalogItemName} blocked: specimen rejected`,
            metadata: {
              orderedTestId: test.id,
              blockReason: 'REJECTED_SPECIMEN',
            },
          });
        } else if (template?.activeVersionId) {
          await tx.orderedTest.update({
            where: { id: test.id },
            data: {
              status: 'READY',
              blockReason: null,
              blockReasonDetail: null,
              department: config?.department ?? null,
              processingMethod: config?.defaultProcessingMethod ?? null,
              analyzerId: config?.defaultAnalyzerId ?? null,
              version: { increment: 1 },
              ...receivedAt,
            },
          });
          tests.push({ id: test.id, status: 'READY' });
          events.push({
            orderId: specimen.orderId,
            eventType: 'TEMPLATE_RESOLVED',
            actorId,
            actorName,
            description: `Template resolved for ${test.catalogItemName}`,
            metadata: {
              orderedTestId: test.id,
              templateDefinitionId: template.id,
              templateVersionId: template.activeVersionId,
            },
          });
        } else {
          const catalogCode =
            test.catalogItem?.code ?? test.catalogItemCode ?? '';
          await tx.orderedTest.update({
            where: { id: test.id },
            data: {
              status: 'BLOCKED',
              blockReason: 'MISSING_RESULT_TEMPLATE',
              blockReasonDetail: `No published template for ${catalogCode} + ${species}`,
              version: { increment: 1 },
              ...receivedAt,
            },
          });
          tests.push({ id: test.id, status: 'BLOCKED' });
          events.push({
            orderId: specimen.orderId,
            eventType: 'TEST_BLOCKED',
            actorId,
            actorName,
            description: `${test.catalogItemName} blocked: no result template`,
            metadata: {
              orderedTestId: test.id,
              blockReason: 'MISSING_RESULT_TEMPLATE',
              catalogCode,
              species,
            },
          });
        }
      }
      await tx.timelineEvent.createMany({ data: events });

      const { orderStatus } = await this.orderStatusService.deriveAndPersist(
        specimen.orderId,
        tx
      );
      return {
        specimen: { id: updated.id, status: updated.status },
        tests,
        order: { id: specimen.orderId, status: orderStatus },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Ask the clinic for another tube for a test blocked by its sample
  // ---------------------------------------------------------------------------

  async requestAnotherSample(
    orderedTestId: string,
    labTenantId: string,
    dto: RequestSampleDto,
    actorId: string,
    actorName: string
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: orderedTestId, order: { labTenantId } },
      select: {
        id: true,
        status: true,
        blockReason: true,
        catalogItemName: true,
        order: {
          select: { id: true, status: true, requisitionNumber: true },
        },
        catalogItem: {
          select: {
            labTestConfigurations: {
              where: { labTenantId },
              select: {
                specimenRequirements: { orderBy: { sortOrder: 'asc' } },
              },
              take: 1,
            },
          },
        },
      },
    });
    if (!test) throw new NotFoundException('Ordered test not found.');
    if (
      test.status !== 'BLOCKED' ||
      !SAMPLE_BLOCK_REASONS.includes(
        test.blockReason as (typeof SAMPLE_BLOCK_REASONS)[number]
      )
    ) {
      throw new BadRequestException(
        'Another sample can only be requested for a test blocked by its sample.'
      );
    }
    if (['COMPLETED', 'CANCELLED'].includes(test.order.status)) {
      throw new BadRequestException(`The order is ${test.order.status}.`);
    }

    const primaryReq =
      test.catalogItem?.labTestConfigurations[0]?.specimenRequirements.find(
        (r) => !r.isAlternativeWithinGroup
      );
    const specimenType = primaryReq?.specimenType ?? dto.specimenType;
    const containerType = primaryReq?.containerType ?? dto.containerType;
    if (!specimenType || !containerType) {
      // No configured requirement: staff must say which sample is needed
      throw new BadRequestException(
        'This test has no configured specimen requirement — choose the specimen and container needed.'
      );
    }

    const orderId = test.order.id;
    const result = await this.prisma.$transaction(async (tx) => {
      // Tests needing the same kind of sample share one requested tube
      const tube =
        (await tx.specimen.findFirst({
          where: { orderId, status: 'EXPECTED', specimenType, containerType },
          select: { id: true, accessionNumber: true },
        })) ??
        (await createRequestedTube(
          tx,
          orderId,
          labTenantId,
          test.order.requisitionNumber,
          specimenType,
          containerType
        ));

      await tx.orderedTestSpecimen.upsert({
        where: {
          orderedTestId_specimenId: {
            orderedTestId: test.id,
            specimenId: tube.id,
          },
        },
        create: { orderedTestId: test.id, specimenId: tube.id },
        update: {},
      });
      await tx.orderedTest.update({
        where: { id: test.id },
        data: {
          status: 'PENDING',
          blockReason: null,
          blockReasonDetail: null,
          version: { increment: 1 },
        },
      });
      await tx.timelineEvent.create({
        data: {
          orderId,
          eventType: 'SAMPLE_REQUESTED',
          actorId,
          actorName,
          description: `Another sample requested for ${test.catalogItemName} (${specimenType})`,
          metadata: {
            orderedTestId: test.id,
            specimenId: tube.id,
            accessionNumber: tube.accessionNumber,
            previousBlockReason: test.blockReason,
            note: dto.note ?? null,
          },
        },
      });
      const { orderStatus } = await this.orderStatusService.deriveAndPersist(
        orderId,
        tx
      );

      // The clinic arranges the new sample (no pickup is created): the vets,
      // and Owner/Admin who usually handle logistics
      const recipients = await clinicOrderRecipients(tx, orderId, {
        includeAdmins: true,
      });
      if (recipients) {
        await this.notifications.publish(tx, {
          type: 'ADDITIONAL_SAMPLE_REQUIRED',
          tenantId: recipients.tenantId,
          // One notification per requested tube, however many tests share it
          eventKey: `specimen:${tube.id}:requested`,
          recipientUserIds: recipients.userIds,
          orderId,
          params: {
            requisitionNumber: recipients.requisitionNumber,
            caseId: recipients.caseId,
            testNames: [test.catalogItemName],
          },
        });
      }

      return {
        specimen: { id: tube.id, accessionNumber: tube.accessionNumber },
        test: { id: test.id, status: 'PENDING' },
        order: { id: orderId, status: orderStatus },
      };
    });
    this.notifications.deliverQueued();
    return result;
  }

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
          // Only tests still waiting for a usable sample (or a template):
          // re-accessioning must never send a test that is ready, in progress
          // or completed back to READY
          where: ACCESSIONABLE_TESTS,
          select: {
            id: true,
            catalogItemId: true,
            catalogItemCode: true,
            catalogItemName: true,
            status: true,
            templateDefinitionId: true,
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
            receivedAt: true,
            receivedById: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');

    // Receiving nothing is not an accession: the lab uses "Receive tube" later
    if (dto.specimens.length > 0 && dto.specimens.every((s) => s.awaiting)) {
      throw new BadRequestException(
        'Receive at least one sample to accession the order. Samples marked "not received yet" are received later.'
      );
    }

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

    // Pre-resolve templates for all unique catalog codes (avoids N+1 inside transaction).
    // A template the lab already picked by hand wins, so re-accessioning never
    // re-blocks that test.
    const templateKey = (test: (typeof order.orderedTests)[number]) =>
      test.templateDefinitionId
        ? `def:${test.templateDefinitionId}`
        : test.catalogItem?.code ?? test.catalogItemCode ?? '';
    const testsByTemplateKey = new Map(
      order.orderedTests.map((test) => [templateKey(test), test])
    );
    const templateCache = new Map<
      string,
      Awaited<ReturnType<typeof this.templateVersionService.resolveTemplate>>
    >();
    await Promise.all(
      Array.from(testsByTemplateKey.entries()).map(async ([key, test]) => {
        const tmpl = await this.templateVersionService.resolveTemplateForTest(
          {
            catalogItemCode: test.catalogItem?.code ?? test.catalogItemCode,
            templateDefinitionId: test.templateDefinitionId,
          },
          labTenantId,
          patientSpecies,
          ageWeeks
        );
        templateCache.set(key, tmpl);
      })
    );

    // Create / update specimens and link tests in a transaction
    const result = await this.prisma.$transaction(
      async (tx) => {
        const timelineEvents: Prisma.TimelineEventCreateManyInput[] = [];
        // Tests left waiting for a sample that hasn't arrived: not stamped
        // as received, and they stay PENDING
        const waitingTestIds = new Set<string>();

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

            const awaiting = s.awaiting === true;
            if (awaiting && existing?.receivedAt) {
              throw new BadRequestException(
                `Specimen ${existing.id} was already received and cannot be marked as not received yet.`
              );
            }
            const specimenStatus = awaiting
              ? 'EXPECTED'
              : s.accepted
              ? 'ACCEPTED'
              : 'REJECTED';
            // A sample that hasn't arrived has no conditions to record
            const conditionData = {
              isHemolyzed: !awaiting && (s.isHemolyzed ?? false),
              isLipemic: !awaiting && (s.isLipemic ?? false),
              isIcteric: !awaiting && (s.isIcteric ?? false),
              isInsufficient: !awaiting && (s.isInsufficient ?? false),
              isContaminated: !awaiting && (s.isContaminated ?? false),
              isWrongContainer: !awaiting && (s.isWrongContainer ?? false),
              isLeaking: !awaiting && (s.isLeaking ?? false),
            };

            const specimen = existing
              ? await tx.specimen.update({
                  where: { id: existing.id },
                  data: {
                    status: specimenStatus,
                    ...conditionData,
                    rejectionReason:
                      s.accepted || awaiting ? null : s.rejectionReason ?? null,
                    notes: s.notes ?? null,
                    // A tube keeps its original receipt when the order is
                    // accessioned again; an awaited one has none yet
                    receivedAt: awaiting ? null : existing.receivedAt ?? now,
                    receivedById: awaiting
                      ? null
                      : existing.receivedAt
                      ? existing.receivedById
                      : actorId,
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
                    rejectionReason:
                      s.accepted || awaiting ? null : s.rejectionReason ?? null,
                    notes: s.notes ?? null,
                    receivedAt: awaiting ? null : now,
                    receivedById: awaiting ? null : actorId,
                  },
                });

            // An awaited sample is logged in the overall accession event only
            if (!awaiting) {
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
            }

            return {
              id: specimen.id,
              accepted: awaiting ? false : s.accepted,
              awaiting,
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

            // Another sample of its kind is still on its way: wait for it
            // rather than blocking on a rejected one
            const matchingAwaiting =
              !matchingAccepted &&
              createdSpecimens.find(
                (sp) =>
                  sp.awaiting &&
                  (!primaryReq ||
                    (sp.specimenType === primaryReq.specimenType &&
                      sp.containerType === primaryReq.containerType))
              );

            const matchingRejected =
              !matchingAccepted &&
              !matchingAwaiting &&
              createdSpecimens.find(
                (sp) =>
                  !sp.accepted &&
                  !sp.awaiting &&
                  (!primaryReq ||
                    (sp.specimenType === primaryReq.specimenType &&
                      sp.containerType === primaryReq.containerType))
              );

            if (matchingAccepted) {
              const catalogCode =
                test.catalogItem?.code ?? test.catalogItemCode ?? '';
              const templateDef = templateCache.get(templateKey(test)) ?? null;

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
            } else if (matchingAwaiting) {
              // Linked to the tube it is waiting for; "Receive tube" moves it
              waitingTestIds.add(test.id);
              await tx.orderedTestSpecimen.upsert({
                where: {
                  orderedTestId_specimenId: {
                    orderedTestId: test.id,
                    specimenId: matchingAwaiting.id,
                  },
                },
                create: {
                  orderedTestId: test.id,
                  specimenId: matchingAwaiting.id,
                },
                update: {},
              });
              if (test.status !== 'PENDING') {
                await tx.orderedTest.update({
                  where: { id: test.id },
                  data: {
                    status: 'PENDING',
                    blockReason: null,
                    blockReasonDetail: null,
                    version: { increment: 1 },
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
              const templateDef = templateCache.get(templateKey(test)) ?? null;

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
          } specimen(s) accepted${
            createdSpecimens.some((s) => s.awaiting)
              ? `, ${
                  createdSpecimens.filter((s) => s.awaiting).length
                } not received yet`
              : ''
          }`,
          metadata: {
            totalSpecimens: createdSpecimens.length,
            accepted: createdSpecimens.filter((s) => s.accepted).length,
            rejected: createdSpecimens.filter((s) => !s.accepted && !s.awaiting)
              .length,
            awaiting: createdSpecimens.filter((s) => s.awaiting).length,
          },
        });

        // Batch: stamp receivedAt + all timeline events in parallel
        await Promise.all([
          tx.orderedTest.updateMany({
            where: {
              orderId,
              receivedAt: null,
              ...(waitingTestIds.size > 0 && {
                id: { notIn: [...waitingTestIds] },
              }),
            },
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
        status: true,
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.specimen.update({
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
        await tx.timelineEvent.create({
          data: {
            orderId: specimen.orderId,
            eventType:
              data.status === 'ACCEPTED'
                ? 'SAMPLE_ACCEPTED'
                : 'SAMPLE_REJECTED',
            actorId,
            actorName,
            description: `Specimen ${specimen.accessionNumber} (${
              specimen.specimenType
            }) ${data.status.toLowerCase()}`,
            metadata: { specimenId, reason: data.rejectionReason },
          },
        });
      }

      // A tube rejected after the fact can't serve tests that haven't started
      // on it — unless another accepted tube already serves them
      if (data.status === 'REJECTED' && specimen.status !== 'REJECTED') {
        const links = await tx.orderedTestSpecimen.findMany({
          where: {
            specimenId,
            orderedTest: { status: { in: ['PENDING', 'READY'] } },
          },
          select: {
            orderedTest: {
              select: {
                id: true,
                specimens: {
                  where: {
                    specimenId: { not: specimenId },
                    specimen: { status: 'ACCEPTED' },
                  },
                  select: { specimenId: true },
                },
              },
            },
          },
        });
        for (const { orderedTest } of links) {
          if (orderedTest.specimens.length > 0) continue;
          await tx.orderedTest.update({
            where: { id: orderedTest.id },
            data: {
              status: 'BLOCKED',
              blockReason: 'REJECTED_SPECIMEN',
              blockReasonDetail: `Specimen ${specimen.accessionNumber} (${specimen.specimenType}) rejected: ${data.rejectionReason}`,
              version: { increment: 1 },
            },
          });
          await tx.timelineEvent.create({
            data: {
              orderId: specimen.orderId,
              eventType: 'TEST_BLOCKED',
              actorId,
              actorName,
              description: `Test blocked: specimen ${specimen.accessionNumber} rejected`,
              metadata: {
                orderedTestId: orderedTest.id,
                blockReason: 'REJECTED_SPECIMEN',
                specimenId,
              },
            },
          });
        }
      }

      await this.orderStatusService.deriveAndPersist(specimen.orderId, tx);
      return updated;
    });
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

    // Only templates this lab can use: platform-wide or its own
    const version = await this.prisma.resultTemplateVersion.findFirst({
      where: {
        id: templateVersionId,
        status: 'PUBLISHED',
        definition: {
          OR: [{ scope: 'PLATFORM' }, { scope: 'LABORATORY', labTenantId }],
        },
      },
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
          // Result entry reads this instead of re-resolving by species
          templateDefinitionId: version.definitionId,
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
