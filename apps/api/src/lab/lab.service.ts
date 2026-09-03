import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OrderStatus, OrderedTestSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDateRangeFilter,
  startOfTodayInTimezone,
} from './date-range.util';
import type { UpdateOrderedTestDto } from './dto/update-ordered-test.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import type { ListLabOrdersDto } from './dto/list-lab-orders.dto';
import type { OrderedItem } from '@vet-ai/shared-types';
import { OrderStatusService } from './order-status.service';

// Default lookback window for the Completed tab when no explicit date range
// is picked — recent completions, not the full all-time archive.
const COMPLETED_DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// Valid status transitions for orders handled by the lab
const LAB_STATUS_TRANSITIONS: Record<string, OrderStatus[]> = {
  PENDING: ['RECEIVED_BY_LAB', 'CANCELLED'],
  READY_FOR_PICKUP: ['RECEIVED_BY_LAB', 'CANCELLED'],
  COLLECTED: ['RECEIVED_BY_LAB', 'CANCELLED'],
  RECEIVED_BY_LAB: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class LabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatusService: OrderStatusService
  ) {}

  // ---------------------------------------------------------------------------
  // Orders queue
  // ---------------------------------------------------------------------------

  async getLabOrders(labTenantId: string, query: ListLabOrdersDto) {
    const { status, search, dateFrom, dateTo, page = 1, pageSize = 20 } = query;
    const statuses = status?.split(',') as OrderStatus[] | undefined;
    const explicitRange = buildDateRangeFilter(dateFrom, dateTo);

    const baseCondition: Record<string, unknown> = { labTenantId };

    if (explicitRange) {
      // An explicit date range always wins, applied to whatever status scope
      // was selected — including "All", which can then surface historical
      // completed orders too.
      if (statuses) {
        baseCondition.status =
          statuses.length === 1 ? statuses[0] : { in: statuses };
      }
      baseCondition.createdAt = explicitRange;
    } else if (!statuses) {
      // Default "All" — operational view: every unresolved order regardless
      // of age, plus orders completed today (lab timezone), so completed
      // orders don't pile up in the daily queue indefinitely.
      const startOfToday = await this.startOfTodayForLab(labTenantId);
      baseCondition.OR = [
        { status: { not: 'COMPLETED' } },
        { status: 'COMPLETED', completedAt: { gte: startOfToday } },
      ];
    } else if (statuses.length === 1 && statuses[0] === 'COMPLETED') {
      // Default "Completed" tab — recent completions only.
      baseCondition.status = 'COMPLETED';
      baseCondition.createdAt = {
        gte: new Date(Date.now() - COMPLETED_DEFAULT_LOOKBACK_MS),
      };
    } else {
      // Awaiting sample / In transit / Received / Processing — every order
      // in that status regardless of age.
      baseCondition.status =
        statuses.length === 1 ? statuses[0] : { in: statuses };
    }

    const conditions: Record<string, unknown>[] = [baseCondition];

    if (search) {
      conditions.push({
        OR: [
          { requisitionNumber: { contains: search, mode: 'insensitive' } },
          { case: { patientName: { contains: search, mode: 'insensitive' } } },
          { tenant: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    const where = { AND: conditions };
    const skip = (page - 1) * pageSize;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          case: {
            select: {
              patientName: true,
              patientSpecies: true,
              ownerName: true,
            },
          },
          tenant: { select: { name: true } },
          orderedTests: {
            orderBy: { createdAt: 'asc' },
            include: { sources: true },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => this.formatLabOrder(o)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getLabOrderById(
    labTenantId: string,
    orderId: string
  ): Promise<
    Prisma.OrderGetPayload<{
      include: {
        case: {
          select: {
            patientName: true;
            patientSpecies: true;
            patientSex: true;
            patientBreed: true;
            patientAge: true;
            patientAgeUnit: true;
            patientWeight: true;
            ownerName: true;
            ownerPhone: true;
            symptoms: true;
          };
        };
        tenant: { select: { name: true; email: true; phone: true } };
        orderedTests: {
          orderBy: { createdAt: 'asc' };
          include: {
            catalogItem: {
              select: { id: true; code: true; name: true; kind: true };
            };
            sources: true;
          };
        };
        resultReport: {
          select: {
            id: true;
            status: true;
            observations: true;
            releasedAt: true;
            submittedForReviewAt: true;
            reviewedAt: true;
            reviewNotes: true;
            correctionNotes: true;
            reviewedBySignerId: true;
          };
        };
        pickup: {
          include: {
            messenger: {
              select: { firstName: true; lastName: true; phone: true };
            };
          };
        };
      };
    }>
  > {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      include: {
        case: {
          select: {
            patientName: true,
            patientSpecies: true,
            patientSex: true,
            patientBreed: true,
            patientAge: true,
            patientAgeUnit: true,
            patientWeight: true,
            ownerName: true,
            ownerPhone: true,
            symptoms: true,
          },
        },
        tenant: { select: { name: true, email: true, phone: true } },
        orderedTests: {
          orderBy: { createdAt: 'asc' },
          include: {
            catalogItem: {
              select: { id: true, code: true, name: true, kind: true },
            },
            sources: true,
          },
        },
        resultReport: {
          select: {
            id: true,
            status: true,
            observations: true,
            releasedAt: true,
            submittedForReviewAt: true,
            reviewedAt: true,
            reviewNotes: true,
            correctionNotes: true,
            reviewedBySignerId: true,
            approvedByName: true,
          },
        },
        pickup: {
          include: {
            messenger: {
              select: { firstName: true, lastName: true, phone: true },
            },
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found.');

    if (order.orderedTests.length === 0) {
      await this.initOrderedTests(labTenantId, orderId);
      return this.getLabOrderById(labTenantId, orderId);
    }

    return order;
  }

  // ---------------------------------------------------------------------------
  // Order status transitions
  // ---------------------------------------------------------------------------

  async updateOrderStatus(
    labTenantId: string,
    orderId: string,
    dto: UpdateOrderStatusDto
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const allowed = LAB_STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(dto.status as OrderStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${order.status} to ${dto.status}.`
      );
    }

    const now = new Date();
    const timestamps: Record<string, Date | null> = {};
    if (dto.status === 'RECEIVED_BY_LAB') timestamps.receivedByLabAt = now;
    if (dto.status === 'PROCESSING') timestamps.processingStartedAt = now;
    if (dto.status === 'COMPLETED') timestamps.completedAt = now;
    if (dto.status === 'CANCELLED') timestamps.cancelledAt = now;

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status as OrderStatus, ...timestamps },
    });

    if (dto.status === 'CANCELLED') {
      await this.prisma.orderedTest.updateMany({
        where: {
          orderId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        data: { status: 'CANCELLED', cancelledAt: now },
      });

      const caseRow = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { caseId: true, case: { select: { status: true } } },
      });
      if (
        caseRow?.case &&
        caseRow.case.status !== 'CANCELLED' &&
        caseRow.case.status !== 'COMPLETED'
      ) {
        await this.prisma.case.update({
          where: { id: caseRow.caseId },
          data: { status: 'CANCELLED' },
        });
      }
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Ordered tests
  // ---------------------------------------------------------------------------

  /**
   * Creates OrderedTest rows from the order's orderedItems JSON snapshot.
   * Expands PACKAGE items into their component TESTs via CatalogItemComposition.
   * Deduplicates: a component appearing in multiple packages (or both directly
   * and via a package) produces one OrderedTest with multiple OrderedTestSource rows.
   * Idempotent — skips if ordered tests already exist for this order.
   */
  async initOrderedTests(labTenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: {
        id: true,
        orderedItems: true,
        orderedTests: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.orderedTests.length > 0) return order.orderedTests;

    const items = order.orderedItems as unknown as OrderedItem[];

    // Collect all package IDs so we can batch-query their components
    const packageIds = items
      .filter((i) => i.kind === 'PACKAGE')
      .map((i) => i.catalogItemId);

    const compositions =
      packageIds.length > 0
        ? await this.prisma.catalogItemComposition.findMany({
            where: { packageId: { in: packageIds } },
            include: {
              component: { select: { id: true, code: true, name: true } },
            },
          })
        : [];

    // Map packageId → component catalog items
    const componentsByPackage = new Map<
      string,
      Array<{ id: string; code: string | null; name: string }>
    >();
    for (const comp of compositions) {
      const list = componentsByPackage.get(comp.packageId) ?? [];
      list.push(comp.component);
      componentsByPackage.set(comp.packageId, list);
    }

    // Build a deduplicated map: catalogItemId → { test data, sources[] }
    const testMap = new Map<
      string,
      {
        catalogItemId: string;
        catalogItemCode: string | null;
        catalogItemName: string;
        sources: Prisma.OrderedTestSourceCreateWithoutOrderedTestInput[];
      }
    >();

    const addSource = (
      catalogItemId: string,
      catalogItemCode: string | null,
      catalogItemName: string,
      source: Prisma.OrderedTestSourceCreateWithoutOrderedTestInput
    ) => {
      const existing = testMap.get(catalogItemId);
      if (existing) {
        existing.sources.push(source);
      } else {
        testMap.set(catalogItemId, {
          catalogItemId,
          catalogItemCode,
          catalogItemName,
          sources: [source],
        });
      }
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const lineKey = `line-${i}`;

      if (item.kind === 'PACKAGE') {
        const components = componentsByPackage.get(item.catalogItemId) ?? [];
        for (const comp of components) {
          addSource(comp.id, comp.code, comp.name, {
            originCatalogItem: { connect: { id: item.catalogItemId } },
            sourceType: OrderedTestSourceType.PACKAGE,
            originalOrderItemKey: lineKey,
            originalOrderItemIndex: i,
            quantity: 1,
            originCode: item.code ?? null,
            originName: item.name,
          });
        }
      } else {
        addSource(item.catalogItemId, item.code, item.name, {
          originCatalogItem: { connect: { id: item.catalogItemId } },
          sourceType: OrderedTestSourceType.DIRECT,
          originalOrderItemKey: lineKey,
          originalOrderItemIndex: i,
          quantity: 1,
          originCode: item.code ?? null,
          originName: item.name,
        });
      }
    }

    const now = new Date();
    return this.prisma.$transaction(
      Array.from(testMap.values()).map((entry) =>
        this.prisma.orderedTest.create({
          data: {
            orderId,
            catalogItemId: entry.catalogItemId,
            catalogItemCode: entry.catalogItemCode ?? null,
            catalogItemName: entry.catalogItemName,
            updatedAt: now,
            sources: { create: entry.sources },
          },
          include: { sources: true },
        })
      )
    );
  }

  async updateOrderedTest(
    labTenantId: string,
    orderedTestId: string,
    dto: UpdateOrderedTestDto,
    actorId?: string,
    actorName?: string
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: {
        id: orderedTestId,
        order: { labTenantId },
      },
      include: {
        order: { select: { id: true } },
        catalogItem: { select: { name: true } },
      },
    });
    if (!test) throw new NotFoundException('Ordered test not found.');

    if (dto.status === 'CANCELLED' && test.status === 'COMPLETED') {
      throw new BadRequestException(
        'Cannot cancel a test that has already been completed.'
      );
    }

    const now = new Date();
    const timestamps: Record<string, Date | null> = {};
    if (dto.status === 'IN_PROGRESS' && !test.startedAt)
      timestamps.startedAt = now;
    if (dto.status === 'COMPLETED') timestamps.completedAt = now;
    if (dto.status === 'CANCELLED') timestamps.cancelledAt = now;

    const updated = await this.prisma.orderedTest.update({
      where: { id: orderedTestId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.entryMethod !== undefined && { entryMethod: dto.entryMethod }),
        ...(dto.assignedUserId !== undefined && {
          assignedUserId: dto.assignedUserId,
        }),
        ...(dto.instrumentId !== undefined && {
          instrumentId: dto.instrumentId,
        }),
        ...timestamps,
      },
    });

    if (dto.status === 'CANCELLED') {
      await this.prisma.timelineEvent.create({
        data: {
          orderId: test.order.id,
          eventType: 'TEST_CANCELLED',
          actorId: actorId ?? null,
          actorName: actorName ?? null,
          description: `${test.catalogItem?.name ?? 'Test'} cancelled`,
          metadata: { orderedTestId: test.id },
        },
      });
      await this.orderStatusService.deriveAndPersist(test.order.id);
    }

    return updated;
  }

  async receiveOrderedTest(labTenantId: string, orderedTestId: string) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: orderedTestId, order: { labTenantId } },
      include: { order: { select: { id: true, status: true } } },
    });
    if (!test) throw new NotFoundException('Ordered test not found.');
    if (test.receivedAt) return test;

    const now = new Date();
    const updated = await this.prisma.orderedTest.update({
      where: { id: orderedTestId },
      data: { receivedAt: now },
    });

    await this.maybeTransitionToReceived(test.order.id, test.order.status, now);
    return updated;
  }

  async receiveAllOrderedTests(labTenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, labTenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const now = new Date();
    await this.prisma.orderedTest.updateMany({
      where: { orderId, receivedAt: null },
      data: { receivedAt: now },
    });

    await this.maybeTransitionToReceived(orderId, order.status, now);

    return this.prisma.orderedTest.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async maybeTransitionToReceived(
    orderId: string,
    currentStatus: string,
    now: Date
  ) {
    const preReceiveStatuses = ['PENDING', 'READY_FOR_PICKUP', 'COLLECTED'];
    if (!preReceiveStatuses.includes(currentStatus)) return;

    const unreceived = await this.prisma.orderedTest.count({
      where: { orderId, receivedAt: null },
    });
    if (unreceived > 0) return;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'RECEIVED_BY_LAB', receivedByLabAt: now },
    });
  }

  // ---------------------------------------------------------------------------
  // Lab settings
  // ---------------------------------------------------------------------------

  async getLaboratoryProfile(labTenantId: string) {
    return this.prisma.laboratoryProfile.findUnique({
      where: { tenantId: labTenantId },
      include: { signers: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async upsertLaboratoryProfile(
    labTenantId: string,
    data: {
      accreditationNumber?: string;
      directorName?: string;
      directorCredentials?: string;
      signatureUrl?: string;
      defaultObservations?: string;
      reportDisclaimer?: string;
      signers?: {
        id?: string;
        name: string;
        roles: string[];
        title?: string;
        specialty?: string;
        university?: string;
        registrationNumber?: string;
        signatureUrl?: string;
      }[];
    }
  ) {
    const { signers, ...profileData } = data;

    const profile = await this.prisma.laboratoryProfile.upsert({
      where: { tenantId: labTenantId },
      create: { tenantId: labTenantId, ...profileData, updatedAt: new Date() },
      update: { ...profileData },
    });

    if (signers !== undefined) {
      const incomingIds = signers.filter((s) => s.id).map((s) => s.id!);

      // Delete signers removed from the list, but only if no release references them
      const toDelete = await this.prisma.labSigner.findMany({
        where: {
          laboratoryProfileId: profile.id,
          ...(incomingIds.length > 0 ? { id: { notIn: incomingIds } } : {}),
        },
        select: { id: true },
      });

      for (const signer of toDelete) {
        const referencedByRelease =
          await this.prisma.resultReportRelease.findFirst({
            where: {
              OR: [{ signerId: signer.id }, { analystId: signer.id }],
            },
            select: { id: true },
          });
        if (!referencedByRelease) {
          await this.prisma.labSigner.delete({
            where: { id: signer.id },
          });
        }
      }

      // Upsert existing signers and create new ones
      const now = new Date();
      for (const s of signers) {
        const signerData = {
          name: s.name,
          roles: s.roles,
          title: s.title ?? '',
          specialty: s.specialty ?? '',
          university: s.university ?? '',
          registrationNumber: s.registrationNumber ?? '',
          signatureUrl: s.signatureUrl ?? null,
          updatedAt: now,
        };

        if (s.id) {
          await this.prisma.labSigner.update({
            where: { id: s.id },
            data: signerData,
          });
        } else {
          await this.prisma.labSigner.create({
            data: {
              laboratoryProfileId: profile.id,
              ...signerData,
            },
          });
        }
      }
    }

    return this.prisma.laboratoryProfile.findUnique({
      where: { id: profile.id },
      include: { signers: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // ---------------------------------------------------------------------------
  // Lab contact info (reads/writes Tenant fields directly)
  // ---------------------------------------------------------------------------

  async getLabContact(labTenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id: labTenantId },
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
        logoUrl: true,
        phoneNumbers: true,
        mapLat: true,
        mapLng: true,
        timezone: true,
      },
    });
  }

  async updateLabContact(
    labTenantId: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
      logoUrl?: string;
      phoneNumbers?: { label: string; number: string }[];
      mapLat?: number;
      mapLng?: number;
      timezone?: string;
    }
  ) {
    if (data.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: data.timezone });
      } catch {
        throw new BadRequestException(
          `"${data.timezone}" is not a valid IANA timezone name.`
        );
      }
    }

    return this.prisma.tenant.update({
      where: { id: labTenantId },
      data,
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
        logoUrl: true,
        phoneNumbers: true,
        mapLat: true,
        mapLng: true,
        timezone: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async startOfTodayForLab(labTenantId: string): Promise<Date> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: labTenantId },
      select: { timezone: true },
    });
    return startOfTodayInTimezone(tenant.timezone);
  }

  private formatLabOrder(order: {
    id: string;
    requisitionNumber: string;
    caseId: string;
    tenantId: string;
    labTenantId: string | null;
    status: string;
    priority: string;
    deliveryMethod: string | null;
    orderedItems: unknown;
    clinicNotes: string | null;
    labNotes: string | null;
    sampleType: string | null;
    sampleNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    collectedAt: Date | null;
    receivedByLabAt: Date | null;
    completedAt: Date | null;
    tenant: { name: string };
    case: { patientName: string; patientSpecies: string; ownerName: string };
    orderedTests: unknown[];
  }) {
    return {
      id: order.id,
      requisitionNumber: order.requisitionNumber,
      caseId: order.caseId,
      tenantId: order.tenantId,
      clinicName: order.tenant.name,
      labTenantId: order.labTenantId,
      status: order.status,
      priority: order.priority,
      deliveryMethod: order.deliveryMethod,
      orderedItems: order.orderedItems,
      orderedTests: order.orderedTests,
      clinicNotes: order.clinicNotes,
      labNotes: order.labNotes,
      sampleType: order.sampleType,
      sampleNotes: order.sampleNotes,
      patientName: order.case.patientName,
      patientSpecies: order.case.patientSpecies,
      ownerName: order.case.ownerName,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      collectedAt: order.collectedAt,
      receivedByLabAt: order.receivedByLabAt,
      completedAt: order.completedAt,
    };
  }
}
