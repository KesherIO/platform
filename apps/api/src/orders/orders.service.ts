import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CaseStatus, VetVerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PickupService } from '../lab/pickup.service';
import { ReadinessService } from '../lab/readiness.service';
import { CreateOrderDto } from './dto/create-order.dto';
import type { OrderedItem } from '@vet-ai/shared-types';

/** Statuses from which an order can be placed. */
const ORDERABLE_STATUSES: CaseStatus[] = [CaseStatus.OPEN, CaseStatus.TRIAGED];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickupService: PickupService,
    private readonly readinessService: ReadinessService
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

    // 4b — Resolve ordering vet (DTO takes precedence; falls back to case.attendingVetId)
    const orderingVetId = body.orderingVetId ?? c.attendingVetId ?? null;
    let vetSnapshot: {
      orderingVetId: string;
      orderingVetName: string;
      orderingVetLicenseNumber: string;
      orderingVetIssuingAuthority: string | null;
    } | null = null;

    if (orderingVetId && labConnection?.labId) {
      const vetData = await this.validateOrderingVet(
        orderingVetId,
        tenantId,
        labConnection.labId
      );
      vetSnapshot = { orderingVetId, ...vetData };
    }

    // 5 — Readiness enforcement: block if any test is not ready
    if (labConnection?.labId) {
      const readiness = await this.readinessService.checkBulkReadiness(
        labConnection.labId
      );
      const readinessMap = new Map(
        readiness.items.map((r) => [r.catalogItemId, r])
      );

      for (const { catalogItem: ci } of selections) {
        if (ci.kind === 'TEST') {
          const r = readinessMap.get(ci.id);
          if (r && !r.ready) {
            throw new BadRequestException({
              message: `Test "${ci.name}" is not operationally ready and cannot be ordered.`,
              readinessReasons: r.reasons,
              catalogItemId: ci.id,
            });
          }
        }
      }

      // For packages: block if ANY component test is not ready
      const packageSelections = selections.filter(
        ({ catalogItem: ci }) => ci.kind === 'PACKAGE'
      );
      if (packageSelections.length > 0) {
        const compositions = await this.prisma.catalogItemComposition.findMany({
          where: {
            packageId: {
              in: packageSelections.map(({ catalogItem }) => catalogItem.id),
            },
          },
          select: {
            packageId: true,
            component: { select: { id: true, name: true } },
          },
        });

        const unreadyComponents: Array<{
          packageName: string;
          componentId: string;
          componentName: string;
          reasons: Array<{
            code: string;
            message: string;
            resourceId?: string;
          }>;
        }> = [];

        const packageNameById = new Map(
          packageSelections.map(({ catalogItem }) => [
            catalogItem.id,
            catalogItem.name,
          ])
        );

        for (const comp of compositions) {
          const r = readinessMap.get(comp.component.id);
          if (r && !r.ready) {
            unreadyComponents.push({
              packageName:
                packageNameById.get(comp.packageId) ?? comp.packageId,
              componentId: comp.component.id,
              componentName: comp.component.name,
              reasons: r.reasons,
            });
          }
        }

        if (unreadyComponents.length > 0) {
          const byPackage = new Map<
            string,
            {
              packageId: string;
              packageName: string;
              unreadyComponents: Array<{
                componentId: string;
                componentName: string;
                reasons: Array<{
                  code: string;
                  message: string;
                  resourceId?: string;
                }>;
              }>;
            }
          >();

          for (const comp of unreadyComponents) {
            const pkgId =
              compositions.find((c) => c.component.id === comp.componentId)
                ?.packageId ?? 'unknown';
            let pkg = byPackage.get(pkgId);
            if (!pkg) {
              pkg = {
                packageId: pkgId,
                packageName: comp.packageName,
                unreadyComponents: [],
              };
              byPackage.set(pkgId, pkg);
            }
            pkg.unreadyComponents.push({
              componentId: comp.componentId,
              componentName: comp.componentName,
              reasons: comp.reasons,
            });
          }

          throw new BadRequestException({
            message: 'Package contains tests that are not operationally ready.',
            packages: Array.from(byPackage.values()),
          });
        }
      }
    }

    // 5 — Create order + requisition number atomically
    const order = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const year = now.getUTCFullYear();
      const labScope = labConnection?.labId ?? '__GLOBAL__';
      const labTenantId = labConnection?.labId ?? null;
      const counterName = `ORDER_SEQ:${labScope}:${year}`;
      const reqPrefix = `REQ-${year}-`;

      // Find the highest existing requisition number for this scope so the
      // counter stays ahead of any orders created before this sequence existed.
      const maxOrder = await tx.order.findFirst({
        where: {
          labTenantId,
          requisitionNumber: { startsWith: reqPrefix },
        },
        orderBy: { requisitionNumber: 'desc' },
        select: { requisitionNumber: true },
      });
      const maxExisting = maxOrder
        ? parseInt(maxOrder.requisitionNumber.slice(reqPrefix.length), 10) || 0
        : 0;

      const counter = await tx.counter.upsert({
        where: { name: counterName },
        update: {
          value: { increment: 1 },
        },
        create: { name: counterName, value: maxExisting + 1 },
      });

      // If the counter fell behind existing orders, leap ahead.
      const nextValue =
        counter.value > maxExisting ? counter.value : maxExisting + 1;

      if (nextValue !== counter.value) {
        await tx.counter.update({
          where: { name: counterName },
          data: { value: nextValue },
        });
      }

      const requisitionNumber = `REQ-${year}-${String(nextValue).padStart(
        6,
        '0'
      )}`;

      const newOrder = await tx.order.create({
        data: {
          requisitionNumber,
          caseId,
          tenantId,
          labTenantId,
          status: 'PENDING',
          priority: body.priority ?? 'ROUTINE',
          deliveryMethod: body.deliveryMethod ?? null,
          orderedItems: orderedItems as object[],
          clinicNotes: body.clinicNotes ?? null,
          orderingVetId: vetSnapshot?.orderingVetId ?? null,
          orderingVetName: vetSnapshot?.orderingVetName ?? null,
          orderingVetLicenseNumber:
            vetSnapshot?.orderingVetLicenseNumber ?? null,
          orderingVetIssuingAuthority:
            vetSnapshot?.orderingVetIssuingAuthority ?? null,
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
    orderingVetId?: string | null;
    orderingVetName?: string | null;
    orderingVetLicenseNumber?: string | null;
    orderingVetIssuingAuthority?: string | null;
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
      orderingVetId: order.orderingVetId ?? undefined,
      orderingVetName: order.orderingVetName ?? undefined,
      orderingVetLicenseNumber: order.orderingVetLicenseNumber ?? undefined,
      orderingVetIssuingAuthority:
        order.orderingVetIssuingAuthority ?? undefined,
    };
  }

  private async validateOrderingVet(
    orderingVetId: string,
    tenantId: string,
    labTenantId: string
  ): Promise<{
    orderingVetName: string;
    orderingVetLicenseNumber: string;
    orderingVetIssuingAuthority: string | null;
  }> {
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: orderingVetId, tenantId } },
    });
    if (!membership) {
      throw new BadRequestException({
        code: 'ORDERING_VET_NOT_MEMBER',
        message: 'The specified ordering vet is not a member of this clinic.',
      });
    }
    if (!membership.isOrderingVet) {
      throw new BadRequestException({
        code: 'ORDERING_VET_NOT_A_VET',
        message:
          'The specified user is not designated as an ordering vet in this clinic.',
      });
    }

    const profile = await this.prisma.veterinarianProfile.findUnique({
      where: { userId: orderingVetId },
      include: { credentials: { where: { replacedAt: null } } },
    });
    if (!profile) {
      throw new BadRequestException({
        code: 'ORDERING_VET_NO_PROFILE',
        message:
          'The specified ordering vet has not created a veterinarian profile.',
      });
    }
    const credential = profile.credentials[0];
    if (!credential) {
      throw new BadRequestException({
        code: 'ORDERING_VET_NO_CREDENTIAL',
        message: 'The specified ordering vet has no active credential on file.',
      });
    }

    if (
      credential.licenseExpiresAt &&
      credential.licenseExpiresAt < new Date()
    ) {
      throw new BadRequestException({
        code: 'ORDERING_VET_LICENSE_EXPIRED',
        message: "The specified ordering vet's license has expired.",
      });
    }

    const labProfile = await this.prisma.laboratoryProfile.findUnique({
      where: { tenantId: labTenantId },
    });
    if (labProfile?.vetVerificationRequired) {
      const verification = await this.prisma.vetLabVerification.findUnique({
        where: {
          vetProfileId_labTenantId: { vetProfileId: profile.id, labTenantId },
        },
      });
      if (
        !verification ||
        verification.status !== VetVerificationStatus.APPROVED
      ) {
        throw new BadRequestException({
          code: 'ORDERING_VET_NOT_APPROVED',
          message:
            'The specified ordering vet has not been approved by this lab.',
          currentStatus: verification?.status ?? 'NOT_SUBMITTED',
        });
      }
    }

    return {
      orderingVetName: profile.legalName,
      orderingVetLicenseNumber: credential.licenseNumber,
      orderingVetIssuingAuthority: credential.issuingAuthority ?? null,
    };
  }
}
