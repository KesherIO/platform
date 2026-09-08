import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientType, ClientStatus, DeliveryMethod } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import type { CreateClientDto } from './dto/create-client.dto';
import type { UpdateClientDto } from './dto/update-client.dto';
import type { ListClientsDto } from './dto/list-clients.dto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class LabClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async listClients(labTenantId: string, query: ListClientsDto) {
    const { status, search, page = 1, pageSize = 20 } = query;

    const conditions: Record<string, unknown>[] = [
      {
        clinicConnections: { some: { labId: labTenantId, isActive: true } },
        type: 'CLINIC',
        ...(status && { clientStatus: status as ClientStatus }),
      },
    ];

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where = { AND: conditions };
    const skip = (page - 1) * pageSize;

    const [clients, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          clientType: true,
          clientStatus: true,
          primaryContactName: true,
          email: true,
          phone: true,
          address: true,
          createdAt: true,
          _count: {
            select: {
              memberships: true,
              orders: true,
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data: clients.map((c) => ({
        id: c.id,
        name: c.name,
        clientType: c.clientType,
        status: c.clientStatus ?? 'PENDING',
        primaryContactName: c.primaryContactName,
        primaryContactEmail: c.email,
        phone: c.phone,
        address: c.address,
        userCount: c._count.memberships,
        orderCount: c._count.orders,
        createdAt: c.createdAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getClientDetail(labTenantId: string, clientTenantId: string) {
    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: {
        clinicId: clientTenantId,
        labId: labTenantId,
        isActive: true,
      },
    });
    if (!connection) {
      throw new NotFoundException(
        'Client not found or not connected to this lab.'
      );
    }

    const client = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: clientTenantId },
      select: {
        id: true,
        name: true,
        clientType: true,
        clientStatus: true,
        primaryContactName: true,
        email: true,
        phone: true,
        address: true,
        createdAt: true,
        updatedAt: true,
        pickupEnabled: true,
        defaultDeliveryMethod: true,
        pickupAddress: true,
        pickupContactName: true,
        pickupContactPhone: true,
        collectionHours: true,
        pickupInstructions: true,
        _count: { select: { orders: true } },
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            requisitionNumber: true,
            status: true,
            priority: true,
            createdAt: true,
            case: {
              select: { patientName: true, patientSpecies: true },
            },
          },
        },
      },
    });

    const lab = await this.prisma.tenant.findUnique({
      where: { id: labTenantId },
      select: { name: true },
    });

    const invitation = await this.prisma.onboardingToken.findFirst({
      where: { laboratoryId: labTenantId, clinicEmail: client.email ?? '' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clinicEmail: true,
        expiresAt: true,
        used: true,
        usedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    return {
      id: client.id,
      name: client.name,
      clientType: client.clientType,
      status: client.clientStatus ?? 'PENDING',
      primaryContactName: client.primaryContactName,
      primaryContactEmail: client.email,
      phone: client.phone,
      address: client.address,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
      orderCount: client._count.orders,
      laboratoryName: lab?.name ?? null,
      pickupEnabled: client.pickupEnabled,
      defaultDeliveryMethod: client.defaultDeliveryMethod,
      pickupAddress: client.pickupAddress,
      pickupContactName: client.pickupContactName,
      pickupContactPhone: client.pickupContactPhone,
      collectionHours: client.collectionHours,
      pickupInstructions: client.pickupInstructions,
      users: client.memberships.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.role,
        joinedAt: m.createdAt,
      })),
      recentOrders: client.orders.map((o) => ({
        id: o.id,
        requisitionNumber: o.requisitionNumber,
        status: o.status,
        priority: o.priority,
        patientName: o.case.patientName,
        patientSpecies: o.case.patientSpecies,
        createdAt: o.createdAt,
      })),
      invitation: invitation
        ? {
            id: invitation.id,
            email: invitation.clinicEmail,
            expiresAt: invitation.expiresAt,
            acceptedAt: invitation.usedAt,
            revokedAt: invitation.revokedAt,
            used: invitation.used,
            createdAt: invitation.createdAt,
          }
        : null,
    };
  }

  async createClient(
    labTenantId: string,
    dto: CreateClientDto,
    createdByUserId: string
  ) {
    const existingByEmail = await this.prisma.tenant.findFirst({
      where: {
        email: dto.primaryContactEmail,
        type: 'CLINIC',
        clinicConnections: { some: { labId: labTenantId } },
      },
    });
    if (existingByEmail) {
      throw new ConflictException(
        'A client with this email is already connected to this lab.'
      );
    }

    let slug = slugify(dto.name);
    const slugConflict = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (slugConflict) {
      slug = `${slug}-${randomBytes(3).toString('hex')}`;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHashed = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug,
          type: 'CLINIC',
          clientType: dto.clientType as ClientType,
          clientStatus: 'PENDING',
          primaryContactName: dto.primaryContactName ?? null,
          email: dto.primaryContactEmail,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
        },
      });

      await tx.clinicLabConnection.create({
        data: {
          clinicId: tenant.id,
          labId: labTenantId,
          isDefault: true,
          isActive: true,
        },
      });

      const invitation = await tx.onboardingToken.create({
        data: {
          tokenHash: tokenHashed,
          type: 'ADMIN',
          clinicName: dto.name,
          clinicEmail: dto.primaryContactEmail,
          clientType: dto.clientType as ClientType,
          laboratoryId: labTenantId,
          expiresAt,
          createdByUserId,
        },
      });

      return { tenant, invitation };
    });

    return {
      clientId: result.tenant.id,
      onboardingToken: rawToken,
      onboardingLink: `/onboarding/welcome?token=${rawToken}`,
      expiresAt,
    };
  }

  async updateClient(
    labTenantId: string,
    clientTenantId: string,
    dto: UpdateClientDto
  ) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.clientType !== undefined)
      updateData.clientType = dto.clientType as ClientType;
    if (dto.primaryContactName !== undefined)
      updateData.primaryContactName = dto.primaryContactName;
    if (dto.primaryContactEmail !== undefined)
      updateData.email = dto.primaryContactEmail;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.address !== undefined) updateData.address = dto.address;

    return this.prisma.tenant.update({
      where: { id: clientTenantId },
      data: updateData,
      select: {
        id: true,
        name: true,
        clientType: true,
        clientStatus: true,
        primaryContactName: true,
        email: true,
        phone: true,
        address: true,
      },
    });
  }

  async suspendClient(labTenantId: string, clientTenantId: string) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    const client = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: clientTenantId },
      select: { clientStatus: true },
    });
    if (client.clientStatus === 'SUSPENDED') {
      throw new BadRequestException('Client is already suspended.');
    }

    return this.prisma.tenant.update({
      where: { id: clientTenantId },
      data: { clientStatus: 'SUSPENDED' },
      select: { id: true, clientStatus: true },
    });
  }

  async reactivateClient(labTenantId: string, clientTenantId: string) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    const client = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: clientTenantId },
      select: { clientStatus: true },
    });
    if (client.clientStatus !== 'SUSPENDED') {
      throw new BadRequestException('Client is not suspended.');
    }

    return this.prisma.tenant.update({
      where: { id: clientTenantId },
      data: { clientStatus: 'ACTIVE' },
      select: { id: true, clientStatus: true },
    });
  }

  async regenerateInvitation(
    labTenantId: string,
    clientTenantId: string,
    createdByUserId: string
  ) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    const client = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: clientTenantId },
      select: { name: true, email: true, clientType: true },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHashed = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.onboardingToken.updateMany({
        where: {
          laboratoryId: labTenantId,
          clinicEmail: client.email ?? '',
          used: false,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      await tx.onboardingToken.create({
        data: {
          tokenHash: tokenHashed,
          type: 'ADMIN',
          clinicName: client.name,
          clinicEmail: client.email ?? '',
          clientType: client.clientType,
          laboratoryId: labTenantId,
          expiresAt,
          createdByUserId,
        },
      });
    });

    return {
      onboardingToken: rawToken,
      onboardingLink: `/onboarding/welcome?token=${rawToken}`,
      expiresAt,
    };
  }

  async revokeInvitation(labTenantId: string, clientTenantId: string) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    const client = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: clientTenantId },
      select: { email: true },
    });

    const result = await this.prisma.onboardingToken.updateMany({
      where: {
        laboratoryId: labTenantId,
        clinicEmail: client.email ?? '',
        used: false,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('No active invitation found to revoke.');
    }

    return { revoked: result.count };
  }

  async deleteClient(labTenantId: string, clientTenantId: string) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    const orderCount = await this.prisma.order.count({
      where: { tenantId: clientTenantId },
    });
    if (orderCount > 0) {
      throw new BadRequestException(
        'Cannot delete a client with existing orders. Suspend the client instead.'
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.onboardingToken.updateMany({
        where: { laboratoryId: labTenantId, clinicEmail: { not: '' } },
        data: { revokedAt: new Date() },
      });
      await tx.clinicLabConnection.deleteMany({
        where: { clinicId: clientTenantId, labId: labTenantId },
      });
      await tx.userTenantMembership.deleteMany({
        where: { tenantId: clientTenantId },
      });
      await tx.tenant.delete({ where: { id: clientTenantId } });
    });
  }

  async updateCollectionSettings(
    labTenantId: string,
    clientTenantId: string,
    dto: {
      pickupEnabled?: boolean;
      defaultDeliveryMethod?: string;
      pickupAddress?: string;
      pickupContactName?: string;
      pickupContactPhone?: string;
      collectionHours?: string;
      pickupInstructions?: string;
    }
  ) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    return this.prisma.tenant.update({
      where: { id: clientTenantId },
      data: {
        ...(dto.pickupEnabled !== undefined && {
          pickupEnabled: dto.pickupEnabled,
        }),
        ...(dto.defaultDeliveryMethod !== undefined && {
          defaultDeliveryMethod: dto.defaultDeliveryMethod as DeliveryMethod,
        }),
        ...(dto.pickupAddress !== undefined && {
          pickupAddress: dto.pickupAddress,
        }),
        ...(dto.pickupContactName !== undefined && {
          pickupContactName: dto.pickupContactName,
        }),
        ...(dto.pickupContactPhone !== undefined && {
          pickupContactPhone: dto.pickupContactPhone,
        }),
        ...(dto.collectionHours !== undefined && {
          collectionHours: dto.collectionHours,
        }),
        ...(dto.pickupInstructions !== undefined && {
          pickupInstructions: dto.pickupInstructions,
        }),
      },
      select: {
        pickupEnabled: true,
        defaultDeliveryMethod: true,
        pickupAddress: true,
        pickupContactName: true,
        pickupContactPhone: true,
        collectionHours: true,
        pickupInstructions: true,
      },
    });
  }

  private async verifyLabClientConnection(
    labTenantId: string,
    clientTenantId: string
  ) {
    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: {
        clinicId: clientTenantId,
        labId: labTenantId,
      },
    });
    if (!connection) {
      throw new NotFoundException(
        'Client not found or not connected to this lab.'
      );
    }
    return connection;
  }
}
