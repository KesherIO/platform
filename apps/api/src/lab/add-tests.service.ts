import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AgeUnit,
  BlockReason,
  Department,
  OrderedTestStatus,
  PatientSpecies,
  Prisma,
  ProcessingMethod,
} from '@prisma/client';
import type { OrderedItem } from '@vet-ai/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { NotificationService } from '../notifications/notification.service';
import { clinicOrderRecipients } from '../notifications/clinic-recipients';
import { OrderStatusService } from './order-status.service';
import { lockOrderReport } from './report-lock.util';
import { expandOrderedItems } from './ordered-test-expansion.util';
import { createRequestedTube } from './requested-tube.util';
import { ageToWeeks } from './specimen.service';
import type { AddTestsDto } from './dto/add-tests.dto';

type Db = Prisma.TransactionClient;

/**
 * What happens to a test the lab adds:
 * - READY: a tube already accepted on the order serves it (or it needs none)
 * - AWAITING_TUBE: it joins a tube already requested and not received yet
 * - NEEDS_NEW_TUBE: the clinic must send another sample (no pickup is created)
 * - NO_TEMPLATE: its sample is covered but no result template is published
 */
export type AddedTestOutcome =
  | 'READY'
  | 'AWAITING_TUBE'
  | 'NEEDS_NEW_TUBE'
  | 'NO_TEMPLATE';

export interface AddTestsPreview {
  tests: Array<{
    catalogItemId: string;
    code: string | null;
    name: string;
    /** The lines (tests or packages) that brought it in */
    origins: string[];
    outcome: AddedTestOutcome;
  }>;
  /** Already on the order (not cancelled): left as they are */
  alreadyOnOrder: Array<{ catalogItemId: string; name: string }>;
  tubes: Array<{
    specimenType: string;
    containerType: string;
    /** false → a new tube is requested from the clinic */
    existing: boolean;
    testNames: string[];
  }>;
  sampleRequired: boolean;
}

interface PlannedTest {
  catalogItemId: string;
  code: string | null;
  name: string;
  origins: string[];
  sources: Awaited<ReturnType<typeof expandOrderedItems>>[number]['sources'];
  outcome: AddedTestOutcome;
  tubeKey: string | null;
  acceptedSpecimenId: string | null;
  config: {
    department: Department;
    defaultProcessingMethod: ProcessingMethod;
    defaultAnalyzerId: string | null;
  } | null;
  templateDefinitionId: string | null;
  templateVersionId: string | null;
}

interface Plan {
  order: {
    id: string;
    caseId: string;
    tenantId: string;
    requisitionNumber: string;
    orderedItems: OrderedItem[];
    patientSpecies: PatientSpecies;
  };
  lines: OrderedItem[];
  tests: PlannedTest[];
  alreadyOnOrder: AddTestsPreview['alreadyOnOrder'];
  tubes: Array<{
    key: string;
    specimenType: string;
    containerType: string;
    existingSpecimenId: string | null;
    testNames: string[];
  }>;
}

const tubeKeyOf = (specimenType: string, containerType: string) =>
  `${specimenType}|${containerType}`;

@Injectable()
export class AddTestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateVersionService: TemplateVersionService,
    private readonly orderStatusService: OrderStatusService,
    private readonly notifications: NotificationService
  ) {}

  /** What adding these tests would do — nothing is written. */
  async preview(
    orderId: string,
    labTenantId: string,
    catalogItemIds: string[]
  ): Promise<AddTestsPreview> {
    const plan = await this.plan(this.prisma, orderId, labTenantId, {
      catalogItemIds,
    });
    return this.toPreview(plan);
  }

  async addTests(
    orderId: string,
    labTenantId: string,
    dto: AddTestsDto,
    actorId: string,
    actorName: string
  ) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const base = await tx.order.findFirst({
          where: { id: orderId, labTenantId },
          select: { id: true, caseId: true, tenantId: true },
        });
        if (!base) throw new NotFoundException('Order not found.');
        // Same lock release and cancellation take: a release decides FINAL vs
        // PARTIAL against a set of tests nobody is changing at that moment
        await lockOrderReport(tx, base);

        // Planned under the lock, so what is saved is what is true now
        const plan = await this.plan(tx, orderId, labTenantId, dto);
        if (plan.tests.length === 0) {
          throw new BadRequestException(
            'Every selected test is already on this order.'
          );
        }
        const preview = this.toPreview(plan);
        const now = new Date();

        // New tubes the clinic must send; tests needing one kind share a tube
        const tubeIdByKey = new Map<string, string>();
        for (const tube of plan.tubes) {
          if (tube.existingSpecimenId) {
            tubeIdByKey.set(tube.key, tube.existingSpecimenId);
          } else {
            const created = await createRequestedTube(
              tx,
              orderId,
              labTenantId,
              plan.order.requisitionNumber,
              tube.specimenType,
              tube.containerType
            );
            tubeIdByKey.set(tube.key, created.id);
          }
        }

        const timeline: Prisma.TimelineEventCreateManyInput[] = [];
        const added: Array<{ id: string; name: string; status: string }> = [];
        for (const test of plan.tests) {
          const { status, blockReason, blockReasonDetail } = this.statusFor(
            test,
            plan.order.patientSpecies
          );
          const row = await tx.orderedTest.create({
            data: {
              orderId,
              catalogItemId: test.catalogItemId,
              catalogItemCode: test.code,
              catalogItemName: test.name,
              status,
              blockReason,
              blockReasonDetail,
              ...(test.outcome === 'READY' || test.outcome === 'NO_TEMPLATE'
                ? {
                    receivedAt: now,
                    department: test.config?.department ?? null,
                    processingMethod:
                      test.config?.defaultProcessingMethod ?? null,
                    analyzerId: test.config?.defaultAnalyzerId ?? null,
                  }
                : {}),
              sources: { createMany: { data: test.sources } },
            },
            select: { id: true },
          });
          const specimenId =
            test.acceptedSpecimenId ??
            (test.tubeKey ? tubeIdByKey.get(test.tubeKey) : undefined);
          if (specimenId) {
            await tx.orderedTestSpecimen.create({
              data: { orderedTestId: row.id, specimenId },
            });
          }
          added.push({ id: row.id, name: test.name, status });

          if (test.outcome === 'READY') {
            timeline.push({
              orderId,
              eventType: 'TEMPLATE_RESOLVED',
              actorId,
              actorName,
              description: `Template resolved for ${test.name}`,
              metadata: {
                orderedTestId: row.id,
                templateDefinitionId: test.templateDefinitionId,
                templateVersionId: test.templateVersionId,
              },
            });
          } else if (test.outcome === 'NO_TEMPLATE') {
            timeline.push({
              orderId,
              eventType: 'TEST_BLOCKED',
              actorId,
              actorName,
              description: `${test.name} blocked: no result template`,
              metadata: {
                orderedTestId: row.id,
                blockReason: 'MISSING_RESULT_TEMPLATE',
                catalogCode: test.code,
                species: plan.order.patientSpecies,
              },
            });
          }
        }

        // The snapshot the clinic and the lab read the order's lines from
        await tx.order.update({
          where: { id: orderId },
          data: {
            orderedItems: [
              ...plan.order.orderedItems,
              ...plan.lines,
            ] as unknown as Prisma.InputJsonValue,
          },
        });

        const event = await tx.timelineEvent.create({
          data: {
            orderId,
            eventType: 'TESTS_ADDED',
            actorId,
            actorName,
            description: `Tests added: ${added.map((a) => a.name).join(', ')}`,
            metadata: {
              orderedTestIds: added.map((a) => a.id),
              testNames: added.map((a) => a.name),
              sampleRequired: preview.sampleRequired,
              newTubes: preview.tubes.filter((t) => !t.existing),
              note: dto.note ?? null,
            },
          },
          select: { id: true },
        });
        if (timeline.length > 0) {
          await tx.timelineEvent.createMany({ data: timeline });
        }

        const { orderStatus } = await this.orderStatusService.deriveAndPersist(
          orderId,
          tx
        );

        // Vets, plus Owner/Admin when the clinic has to send another sample
        const recipients = await clinicOrderRecipients(tx, orderId, {
          includeAdmins: preview.sampleRequired,
        });
        if (recipients) {
          await this.notifications.publish(tx, {
            type: 'TESTS_ADDED',
            tenantId: recipients.tenantId,
            eventKey: `order:${orderId}:tests-added:${event.id}`,
            recipientUserIds: recipients.userIds,
            orderId,
            params: {
              requisitionNumber: recipients.requisitionNumber,
              caseId: recipients.caseId,
              testNames: added.map((a) => a.name),
              sampleRequired: preview.sampleRequired,
            },
          });
        }

        return {
          added,
          alreadyOnOrder: preview.alreadyOnOrder,
          sampleRequired: preview.sampleRequired,
          tubes: preview.tubes,
          order: { id: orderId, status: orderStatus },
        };
      },
      { timeout: 30000 }
    );
    this.notifications.deliverQueued();
    return result;
  }

  private statusFor(
    test: PlannedTest,
    species: PatientSpecies
  ): {
    status: OrderedTestStatus;
    blockReason: BlockReason | null;
    blockReasonDetail: string | null;
  } {
    switch (test.outcome) {
      case 'READY':
        return { status: 'READY', blockReason: null, blockReasonDetail: null };
      case 'NO_TEMPLATE':
        return {
          status: 'BLOCKED',
          blockReason: 'MISSING_RESULT_TEMPLATE',
          blockReasonDetail: `No published template for ${
            test.code ?? ''
          } + ${species}`,
        };
      default:
        // Waiting for a tube: receiving it moves the test on
        return {
          status: 'PENDING',
          blockReason: null,
          blockReasonDetail: null,
        };
    }
  }

  private toPreview(plan: Plan): AddTestsPreview {
    const tubes = plan.tubes.map((t) => ({
      specimenType: t.specimenType,
      containerType: t.containerType,
      existing: t.existingSpecimenId !== null,
      testNames: t.testNames,
    }));
    return {
      tests: plan.tests.map((t) => ({
        catalogItemId: t.catalogItemId,
        code: t.code,
        name: t.name,
        origins: t.origins,
        outcome: t.outcome,
      })),
      alreadyOnOrder: plan.alreadyOnOrder,
      tubes,
      sampleRequired: tubes.some((t) => !t.existing),
    };
  }

  /** Works out, without writing, what adding the selected items would do. */
  private async plan(
    db: Db,
    orderId: string,
    labTenantId: string,
    dto: { catalogItemIds: string[] }
  ): Promise<Plan> {
    const order = await db.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        status: true,
        caseId: true,
        tenantId: true,
        requisitionNumber: true,
        orderedItems: true,
        case: {
          select: {
            patientSpecies: true,
            patientAge: true,
            patientAgeUnit: true,
          },
        },
        orderedTests: {
          where: { status: { not: 'CANCELLED' } },
          select: { catalogItemId: true },
        },
        specimens: {
          where: { status: { in: ['ACCEPTED', 'EXPECTED'] } },
          select: {
            id: true,
            status: true,
            specimenType: true,
            containerType: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestException(
        `Tests can't be added: the order is ${order.status}.`
      );
    }

    const catalogItems = await db.catalogItem.findMany({
      where: {
        id: { in: dto.catalogItemIds },
        labTenantId,
        active: true,
      },
      select: {
        id: true,
        kind: true,
        code: true,
        name: true,
        category: true,
        turnaroundHours: true,
      },
    });
    if (catalogItems.length !== new Set(dto.catalogItemIds).size) {
      throw new BadRequestException(
        'Some selected tests are not in this laboratory’s active catalog.'
      );
    }

    const orderedItems = order.orderedItems as unknown as OrderedItem[];
    // Keep the order the lab picked them in
    const lines: OrderedItem[] = dto.catalogItemIds.map((id) => {
      const item = catalogItems.find((c) => c.id === id)!;
      return {
        catalogItemId: item.id,
        code: item.code,
        name: item.name,
        kind: item.kind as OrderedItem['kind'],
        category: item.category,
        turnaroundHours: item.turnaroundHours,
      };
    });

    const expanded = await expandOrderedItems(db, lines, orderedItems.length);
    const onOrder = new Set(order.orderedTests.map((t) => t.catalogItemId));
    const alreadyOnOrder = expanded
      .filter((e) => onOrder.has(e.catalogItemId))
      .map((e) => ({
        catalogItemId: e.catalogItemId,
        name: e.catalogItemName,
      }));
    const toAdd = expanded.filter((e) => !onOrder.has(e.catalogItemId));

    const configs = await db.catalogItem.findMany({
      where: { id: { in: toAdd.map((e) => e.catalogItemId) } },
      select: {
        id: true,
        code: true,
        labTestConfigurations: {
          where: { labTenantId },
          select: {
            department: true,
            defaultProcessingMethod: true,
            defaultAnalyzerId: true,
            specimenRequirements: { orderBy: { sortOrder: 'asc' } },
          },
          take: 1,
        },
      },
    });
    const configById = new Map(configs.map((c) => [c.id, c]));

    const species = order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      order.case.patientAge && order.case.patientAgeUnit
        ? ageToWeeks(
            order.case.patientAge,
            order.case.patientAgeUnit as AgeUnit
          )
        : null;

    const accepted = order.specimens.filter((s) => s.status === 'ACCEPTED');
    const awaited = order.specimens.filter((s) => s.status === 'EXPECTED');

    const tubes = new Map<
      Plan['tubes'][number]['key'],
      Plan['tubes'][number]
    >();
    const tests: PlannedTest[] = [];

    for (const entry of toAdd) {
      const catalog = configById.get(entry.catalogItemId);
      const config = catalog?.labTestConfigurations[0] ?? null;
      const primaryReq = config?.specimenRequirements.find(
        (r) => !r.isAlternativeWithinGroup
      );
      const matches = (s: { specimenType: string; containerType: string }) =>
        s.specimenType === primaryReq?.specimenType &&
        s.containerType === primaryReq?.containerType;

      const origins = [...new Set(entry.sources.map((s) => s.originName))];
      const base = {
        catalogItemId: entry.catalogItemId,
        code: entry.catalogItemCode,
        name: entry.catalogItemName,
        origins,
        sources: entry.sources,
        config: config
          ? {
              department: config.department,
              defaultProcessingMethod: config.defaultProcessingMethod,
              defaultAnalyzerId: config.defaultAnalyzerId,
            }
          : null,
      };

      const acceptedTube = primaryReq ? accepted.find(matches) : undefined;
      if (primaryReq && !acceptedTube) {
        // Needs a sample that isn't at the lab: share a requested tube of
        // that kind, or ask for a new one
        const key = tubeKeyOf(
          primaryReq.specimenType,
          primaryReq.containerType
        );
        let tube = tubes.get(key);
        if (!tube) {
          tube = {
            key,
            specimenType: primaryReq.specimenType,
            containerType: primaryReq.containerType,
            existingSpecimenId: awaited.find(matches)?.id ?? null,
            testNames: [],
          };
          tubes.set(key, tube);
        }
        tube.testNames.push(entry.catalogItemName);
        tests.push({
          ...base,
          outcome: tube.existingSpecimenId ? 'AWAITING_TUBE' : 'NEEDS_NEW_TUBE',
          tubeKey: key,
          acceptedSpecimenId: null,
          templateDefinitionId: null,
          templateVersionId: null,
        });
        continue;
      }

      // Sample covered (or none needed): ready if a template is published
      const template = await this.templateVersionService.resolveTemplateForTest(
        {
          catalogItemCode: catalog?.code ?? entry.catalogItemCode,
          templateDefinitionId: null,
        },
        labTenantId,
        species,
        ageWeeks
      );
      tests.push({
        ...base,
        outcome: template?.activeVersionId ? 'READY' : 'NO_TEMPLATE',
        tubeKey: null,
        acceptedSpecimenId: acceptedTube?.id ?? null,
        templateDefinitionId: template?.id ?? null,
        templateVersionId: template?.activeVersionId ?? null,
      });
    }

    return {
      order: {
        id: order.id,
        caseId: order.caseId,
        tenantId: order.tenantId,
        requisitionNumber: order.requisitionNumber,
        orderedItems,
        patientSpecies: species,
      },
      lines,
      tests,
      alreadyOnOrder,
      tubes: Array.from(tubes.values()),
    };
  }
}
