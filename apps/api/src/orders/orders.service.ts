import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CaseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PickupService } from '../lab/pickup.service';
import { CreateOrderDto } from './dto/create-order.dto';
import type { OrderedItem } from '@vet-ai/shared-types';

/** Statuses from which an order can be placed. */
const ORDERABLE_STATUSES: CaseStatus[] = [CaseStatus.OPEN, CaseStatus.TRIAGED];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickupService: PickupService
  ) {}

  // ---------------------------------------------------------------------------
  // POST /cases/:id/order
  // ---------------------------------------------------------------------------

  async createOrderForCase(
    tenantId: string,
    caseId: string,
    body: CreateOrderDto
  ) {
    // 1 — Validate case
    const c = await this.prisma.case.findFirst({
      where: { id: caseId, tenantId },
    });
    if (!c) throw new NotFoundException('Case not found.');
    if (!ORDERABLE_STATUSES.includes(c.status)) {
      throw new BadRequestException(
        'An order can only be created from an OPEN or TRIAGED case.'
      );
    }

    // Guard: one order per case
    const existing = await this.prisma.order.findUnique({ where: { caseId } });
    if (existing) {
      throw new ConflictException('An order already exists for this case.');
    }

    // 2 — Fetch selected catalog items for snapshot
    const selections = await this.prisma.caseCatalogItem.findMany({
      where: { caseId },
      include: { catalogItem: true },
    });
    if (selections.length === 0) {
      throw new BadRequestException(
        'Select at least one test before sending an order.'
      );
    }

    // 3 — Build denormalized snapshot (stable even if catalog changes later)
    const orderedItems: OrderedItem[] = selections.map(
      ({ catalogItem: ci }) => ({
        catalogItemId: ci.id,
        code: ci.code ?? null,
        name: ci.name,
        kind: ci.kind as OrderedItem['kind'],
        category: ci.category ?? null,
        turnaroundHours: ci.turnaroundHours ?? null,
      })
    );

    // 4 — Resolve the lab that processes this clinic's orders
    const labConnection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: tenantId, isActive: true },
      orderBy: { isDefault: 'desc' },
      select: { labId: true },
    });

    // 5 — Create order + requisition number atomically
    const order = await this.prisma.$transaction(async (tx) => {
      // Atomic counter increment — safe under concurrent requests
      const counter = await tx.counter.upsert({
        where: { name: 'ORDER_SEQ' },
        update: { value: { increment: 1 } },
        create: { name: 'ORDER_SEQ', value: 1 },
      });

      const year = new Date().getFullYear();
      const requisitionNumber = `REQ-${year}-${String(counter.value).padStart(
        6,
        '0'
      )}`;

      const newOrder = await tx.order.create({
        data: {
          requisitionNumber,
          caseId,
          tenantId,
          labTenantId: labConnection?.labId ?? null,
          status: 'PENDING',
          priority: body.priority ?? 'ROUTINE',
          deliveryMethod: body.deliveryMethod ?? null,
          orderedItems: orderedItems as object[],
          clinicNotes: body.clinicNotes ?? null,
        },
      });

      // Advance case status to ORDERED
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: CaseStatus.ORDERED,
          orderSentAt: new Date(),
          orderNotes: body.clinicNotes ?? null,
        },
      });

      await tx.timelineEvent.create({
        data: {
          orderId: newOrder.id,
          eventType: 'ORDER_CREATED',
          description: 'Order created.',
        },
      });

      return newOrder;
    });

    // Skip pickup creation if there's no lab connected to this clinic — the
    // order still gets created, just without a courier workflow attached.
    if (body.deliveryMethod === 'LAB_PICKUP' && labConnection?.labId) {
      const clinicTenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          pickupAddress: true,
          pickupContactName: true,
          pickupContactPhone: true,
          pickupInstructions: true,
        },
      });
      await this.pickupService.createPickup(
        order.id,
        labConnection.labId,
        tenantId,
        clinicTenant,
        order.priority
      );
    }

    return this.formatOrder(order);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private formatOrder(order: {
    id: string;
    requisitionNumber: string;
    status: string;
    priority: string;
    deliveryMethod: string | null;
    orderedItems: unknown;
    clinicNotes: string | null;
    createdAt: Date;
  }) {
    return {
      id: order.id,
      requisitionNumber: order.requisitionNumber,
      status: order.status,
      priority: order.priority,
      deliveryMethod: order.deliveryMethod ?? undefined,
      orderedItems: order.orderedItems as OrderedItem[],
      clinicNotes: order.clinicNotes ?? undefined,
      requisitionUrl: `/api/orders/${order.id}/requisition`,
      createdAt: order.createdAt,
    };
  }
}
