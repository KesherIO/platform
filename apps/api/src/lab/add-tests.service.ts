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
import { ageToWeeks } from './specimen.service';
import type { AddTestsDto } from './dto/add-tests.dto';

type Db = Prisma.TransactionClient;

/**
 * Tests are added only onto samples already accepted at the lab — adding never
 * requests a sample from the clinic. Per test:
 * - READY: accepted tubes cover every specimen-requirement group
 * - NO_TEMPLATE: covered, but no result template is published (added BLOCKED)
 * - AWAITING_SPECIMEN: a compatible tube is expected or received but not
 *   accepted yet — can't be added
 * - NO_SPECIMEN: no compatible tube at the lab — can't be added
 * - NO_REQUIREMENT: no specimen requirement configured, so compatibility
 *   can't be checked — can't be added
 */
export type AddedTestOutcome =
  | 'READY'
  | 'NO_TEMPLATE'
  | 'AWAITING_SPECIMEN'
  | 'NO_SPECIMEN'
  | 'NO_REQUIREMENT';

const ADDABLE: readonly AddedTestOutcome[] = ['READY', 'NO_TEMPLATE'];

const CONDITION_FLAGS = [
  'isHemolyzed',
  'isLipemic',
  'isIcteric',
  'isInsufficient',
  'isContaminated',
  'isWrongContainer',
  'isLeaking',
] as const;
type ConditionFlag = (typeof CONDITION_FLAGS)[number];

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
  /** Accepted tubes the added tests would run on. Staff confirm each has
   * enough usable sample left before saving. */
  specimens: Array<{
    id: string;
    accessionNumber: string;
    specimenType: string;
    containerType: string;
    /** Condition flags recorded at receipt (e.g. isHemolyzed) */
    conditions: ConditionFlag[];
    testNames: string[];
  }>;
  /** Something new to add and every test can be added */
  canAdd: boolean;
}

interface PlannedTest {
  catalogItemId: string;
  code: string | null;
  name: string;
  origins: string[];
  sources: Awaited<ReturnType<typeof expandOrderedItems>>[number]['sources'];
  outcome: AddedTestOutcome;
  /** Accepted tubes it runs on, one per requirement group */
  specimenIds: string[];
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
  specimens: AddTestsPreview['specimens'];
}

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
        // Specimen changes don't take the report lock: hold the order's tubes
        // so one accepted now can't be rejected before these tests link to it
        await tx.$queryRaw`SELECT id FROM specimens WHERE "orderId" = ${orderId} FOR UPDATE`;

        // Planned under the locks, so what is saved is what is true now
        const plan = await this.plan(tx, orderId, labTenantId, dto);
        if (plan.tests.length === 0) {
          throw new BadRequestException(
            'Every selected test is already on this order.'
          );
        }
        const notAddable = plan.tests.filter(
          (t) => !ADDABLE.includes(t.outcome)
        );
        if (notAddable.length > 0) {
          throw new BadRequestException(
            `Tests can only be added onto a sample already accepted at the lab: ${notAddable
              .map((t) => t.name)
              .join(', ')}.`
          );
        }
        const confirmed = new Set(dto.confirmedSpecimenIds);
        const unconfirmed = plan.specimens.filter((s) => !confirmed.has(s.id));
        if (unconfirmed.length > 0) {
          throw new BadRequestException(
            `Confirm there is enough usable sample in ${unconfirmed
              .map((s) => s.accessionNumber)
              .join(', ')}.`
          );
        }
        const preview = this.toPreview(plan);
        const now = new Date();

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
              // Its sample is already at the lab
              receivedAt: now,
              department: test.config?.department ?? null,
              processingMethod: test.config?.defaultProcessingMethod ?? null,
              analyzerId: test.config?.defaultAnalyzerId ?? null,
              sources: { createMany: { data: test.sources } },
            },
            select: { id: true },
          });
          await tx.orderedTestSpecimen.createMany({
            data: test.specimenIds.map((specimenId) => ({
              orderedTestId: row.id,
              specimenId,
            })),
          });
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
              // Tubes the actor confirmed have enough usable sample
              confirmedSpecimens: preview.specimens.map((s) => ({
                id: s.id,
                accessionNumber: s.accessionNumber,
                testNames: s.testNames,
              })),
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

        // Informational: the clinic has nothing to send, so vets only
        const recipients = await clinicOrderRecipients(tx, orderId, {
          includeAdmins: false,
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
            },
          });
        }

        return {
          added,
          alreadyOnOrder: preview.alreadyOnOrder,
          specimens: preview.specimens,
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
    // Only READY and NO_TEMPLATE get this far (see ADDABLE)
    if (test.outcome === 'NO_TEMPLATE') {
      return {
        status: 'BLOCKED',
        blockReason: 'MISSING_RESULT_TEMPLATE',
        blockReasonDetail: `No published template for ${
          test.code ?? ''
        } + ${species}`,
      };
    }
    return { status: 'READY', blockReason: null, blockReasonDetail: null };
  }

  private toPreview(plan: Plan): AddTestsPreview {
    return {
      tests: plan.tests.map((t) => ({
        catalogItemId: t.catalogItemId,
        code: t.code,
        name: t.name,
        origins: t.origins,
        outcome: t.outcome,
      })),
      alreadyOnOrder: plan.alreadyOnOrder,
      specimens: plan.specimens,
      canAdd:
        plan.tests.length > 0 &&
        plan.tests.every((t) => ADDABLE.includes(t.outcome)),
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
        // At the lab and usable (ACCEPTED), or still to come / to be judged
        specimens: {
          where: { status: { in: ['ACCEPTED', 'RECEIVED', 'EXPECTED'] } },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            accessionNumber: true,
            status: true,
            specimenType: true,
            containerType: true,
            isHemolyzed: true,
            isLipemic: true,
            isIcteric: true,
            isInsufficient: true,
            isContaminated: true,
            isWrongContainer: true,
            isLeaking: true,
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
    const notYetAccepted = order.specimens.filter(
      (s) => s.status !== 'ACCEPTED'
    );
    const specimens = new Map<string, Plan['specimens'][number]>();
    const tests: PlannedTest[] = [];

    for (const entry of toAdd) {
      const catalog = configById.get(entry.catalogItemId);
      const config = catalog?.labTestConfigurations[0] ?? null;
      const requirements = config?.specimenRequirements ?? [];

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
      const notAddable = (outcome: AddedTestOutcome): PlannedTest => ({
        ...base,
        outcome,
        specimenIds: [],
        templateDefinitionId: null,
        templateVersionId: null,
      });

      if (requirements.length === 0) {
        // Nothing to check a tube against
        tests.push(notAddable('NO_REQUIREMENT'));
        continue;
      }

      // Each requirement group needs one accepted tube matching any of its
      // requirements, the primary one preferred (requirements are sorted)
      const groups = new Map<string, typeof requirements>();
      for (const r of requirements) {
        groups.set(r.requirementGroupKey, [
          ...(groups.get(r.requirementGroupKey) ?? []),
          r,
        ]);
      }
      const specimenIds: string[] = [];
      let missing: 'AWAITING_SPECIMEN' | 'NO_SPECIMEN' | null = null;
      for (const reqs of groups.values()) {
        const ordered = [
          ...reqs.filter((r) => !r.isAlternativeWithinGroup),
          ...reqs.filter((r) => r.isAlternativeWithinGroup),
        ];
        const matches =
          (r: (typeof reqs)[number]) =>
          (s: { specimenType: string; containerType: string }) =>
            s.specimenType === r.specimenType &&
            s.containerType === r.containerType;
        const tube = ordered
          .map((r) => accepted.find(matches(r)))
          .find((t) => t !== undefined);
        if (tube) {
          specimenIds.push(tube.id);
        } else if (ordered.some((r) => notYetAccepted.some(matches(r)))) {
          missing ??= 'AWAITING_SPECIMEN';
        } else {
          missing = 'NO_SPECIMEN';
        }
      }
      if (missing) {
        tests.push(notAddable(missing));
        continue;
      }

      // Sample at the lab: ready if a template is published
      const template = await this.templateVersionService.resolveTemplateForTest(
        {
          catalogItemCode: catalog?.code ?? entry.catalogItemCode,
          templateDefinitionId: null,
        },
        labTenantId,
        species,
        ageWeeks
      );
      const uniqueIds = [...new Set(specimenIds)];
      for (const id of uniqueIds) {
        const tube = accepted.find((s) => s.id === id)!;
        const used = specimens.get(id) ?? {
          id,
          accessionNumber: tube.accessionNumber,
          specimenType: tube.specimenType,
          containerType: tube.containerType,
          conditions: CONDITION_FLAGS.filter((f) => tube[f]),
          testNames: [],
        };
        used.testNames.push(entry.catalogItemName);
        specimens.set(id, used);
      }
      tests.push({
        ...base,
        outcome: template?.activeVersionId ? 'READY' : 'NO_TEMPLATE',
        specimenIds: uniqueIds,
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
      // Only tubes of tests that can be added: blocked ones aren't saved
      specimens: tests.some((t) => !ADDABLE.includes(t.outcome))
        ? []
        : Array.from(specimens.values()),
    };
  }
}
