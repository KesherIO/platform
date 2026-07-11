import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrderedTestDto } from './dto/update-ordered-test.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';

// Valid status transitions for orders handled by the lab
const LAB_STATUS_TRANSITIONS: Record<string, OrderStatus[]> = {
  PENDING:         ['RECEIVED_BY_LAB', 'CANCELLED'],
  READY_FOR_PICKUP: ['RECEIVED_BY_LAB', 'CANCELLED'],
  COLLECTED:       ['RECEIVED_BY_LAB', 'CANCELLED'],
  RECEIVED_BY_LAB: ['PROCESSING', 'CANCELLED'],
  PROCESSING:      ['COMPLETED', 'CANCELLED'],
  COMPLETED:       [],
  CANCELLED:       [],
};

@Injectable()
export class LabService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Orders queue
  // ---------------------------------------------------------------------------

  async getLabOrders(labTenantId: string, status?: string) {
    const where = status
      ? { labTenantId, status: status as OrderStatus }
      : { labTenantId };

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
        },
      },
    });

    return orders.map((o) => this.formatLabOrder(o));
  }

  async getLabOrderById(labTenantId: string, orderId: string) {
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
          },
        },
        resultReport: {
          select: {
            id: true,
            status: true,
            observations: true,
            releasedAt: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found.');

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
    if (dto.status === 'PROCESSING')      timestamps.processingStartedAt = now;
    if (dto.status === 'COMPLETED')        timestamps.completedAt = now;
    if (dto.status === 'CANCELLED')        timestamps.cancelledAt = now;

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status as OrderStatus, ...timestamps },
    });
  }

  // ---------------------------------------------------------------------------
  // Ordered tests
  // ---------------------------------------------------------------------------

  /**
   * Creates OrderedTest rows from the order's orderedItems JSON snapshot.
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

    const items = order.orderedItems as Array<{
      catalogItemId: string;
      code: string | null;
      name: string;
    }>;

    const now = new Date();
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.orderedTest.create({
          data: {
            orderId,
            catalogItemId: item.catalogItemId,
            catalogItemCode: item.code ?? null,
            catalogItemName: item.name,
            updatedAt: now,
          },
        })
      )
    );
  }

  async updateOrderedTest(
    labTenantId: string,
    orderedTestId: string,
    dto: UpdateOrderedTestDto
  ) {
    // Verify the ordered test belongs to an order of this lab
    const test = await this.prisma.orderedTest.findFirst({
      where: {
        id: orderedTestId,
        order: { labTenantId },
      },
    });
    if (!test) throw new NotFoundException('Ordered test not found.');

    const now = new Date();
    const timestamps: Record<string, Date | null> = {};
    if (dto.status === 'IN_PROGRESS' && !test.startedAt) timestamps.startedAt = now;
    if (dto.status === 'COMPLETED')                       timestamps.completedAt = now;
    if (dto.status === 'CANCELLED')                       timestamps.cancelledAt = now;

    return this.prisma.orderedTest.update({
      where: { id: orderedTestId },
      data: {
        ...(dto.status      !== undefined && { status: dto.status }),
        ...(dto.entryMethod !== undefined && { entryMethod: dto.entryMethod }),
        ...(dto.assignedUserId !== undefined && { assignedUserId: dto.assignedUserId }),
        ...(dto.instrumentId   !== undefined && { instrumentId: dto.instrumentId }),
        ...timestamps,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Lab settings
  // ---------------------------------------------------------------------------

  async getLaboratoryProfile(labTenantId: string) {
    return this.prisma.laboratoryProfile.findUnique({
      where: { tenantId: labTenantId },
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
    }
  ) {
    return this.prisma.laboratoryProfile.upsert({
      where: { tenantId: labTenantId },
      create: { tenantId: labTenantId, ...data, updatedAt: new Date() },
      update: { ...data },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private formatLabOrder(order: {
    id: string;
    requisitionNumber: string;
    caseId: string;
    tenantId: string;
    labTenantId: string | null;
    status: string;
    priority: string;
    orderedItems: unknown;
    clinicNotes: string | null;
    labNotes: string | null;
    sampleType: string | null;
    sampleNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
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
      receivedByLabAt: order.receivedByLabAt,
      completedAt: order.completedAt,
    };
  }
}
