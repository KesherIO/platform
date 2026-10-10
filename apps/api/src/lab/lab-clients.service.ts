import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClientType,
  ClientStatus,
  DeliveryMethod,
  Prisma,
} from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import type { CreateClientDto } from './dto/create-client.dto';
import type { UpdateClientDto } from './dto/update-client.dto';
import type { ListClientsDto } from './dto/list-clients.dto';
import type { ImportClientsDto } from './dto/import-clients.dto';
import {
  CLINIC_PROFILE_SELECT,
  buildClinicProfileUpdate,
} from '../tenants/clinic-profile.util';
import {
  checkTaxIdentity,
  clientEmailKey,
  clientTaxKey,
  hashImportRow,
  taxKeyString,
  toNewClinicInput,
  validateImportRow,
  type ImportClientsResponse,
  type ImportRowResult,
  type NewClinicInput,
  type RowFieldError,
  type SkipReason,
} from './client-import.util';

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

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** Error kind for logs — never the message, which may quote row values. */
function describeError(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  return err instanceof Error ? err.name : 'unknown';
}

/** The advisory-lock wait counts toward these (plan A5). */
const CLIENT_CREATE_TX_OPTIONS = { maxWait: 5000, timeout: 10000 };

interface CreateClinicOptions {
  createdByUserId: string;
  withInvitation: boolean;
  /** Bulk import only: identity of the row, for safe retries */
  importRow?: { batchId: string; rowNumber: number };
  /** Set on the retry after a slug conflict */
  forceSlugSuffix?: boolean;
}

type CreateClinicOutcome =
  | {
      status: 'created';
      clientId: string;
      /** Only with `withInvitation`, and never for a replay */
      invitation?: { rawToken: string; expiresAt: Date };
    }
  | { status: 'skipped'; reason: SkipReason; clientId: string }
  | { status: 'conflict'; reason: 'BATCH_ROW_MISMATCH' };

@Injectable()
export class LabClientsService {
  private readonly logger = new Logger(LabClientsService.name);

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
          ...CLINIC_PROFILE_SELECT,
          clientType: true,
          clientStatus: true,
          createdAt: true,
          clinicConnections: {
            where: { labId: labTenantId },
            select: { notes: true },
            take: 1,
          },
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
        city: c.city,
        country: c.country,
        legalName: c.legalName,
        taxIdType: c.taxIdType,
        taxId: c.taxId,
        notes: c.clinicConnections[0]?.notes ?? null,
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
        ...CLINIC_PROFILE_SELECT,
        clientType: true,
        clientStatus: true,
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
      where: { laboratoryId: labTenantId, clinicTenantId: clientTenantId },
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
      city: client.city,
      country: client.country,
      legalName: client.legalName,
      taxIdType: client.taxIdType,
      taxId: client.taxId,
      notes: connection.notes,
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
    this.assertValidTaxIdentity(dto);

    const outcome = await this.runClinicCreate(
      labTenantId,
      toNewClinicInput(dto),
      { createdByUserId, withInvitation: true }
    );

    if (outcome.status === 'skipped') {
      throw new ConflictException(
        outcome.reason === 'EMAIL_EXISTS'
          ? 'A client with this email is already connected to this lab.'
          : 'A client with this tax ID is already connected to this lab.'
      );
    }
    // 'conflict' only exists for import rows, and withInvitation always
    // creates one for a new client.
    if (outcome.status !== 'created' || !outcome.invitation) {
      throw new Error(`Unexpected client create outcome: ${outcome.status}`);
    }

    const { rawToken, expiresAt } = outcome.invitation;
    return {
      clientId: outcome.clientId,
      onboardingToken: rawToken,
      onboardingLink: `/onboarding/welcome?token=${rawToken}`,
      expiresAt,
    };
  }

  /**
   * Bulk import (plan A2-A5). Creates client organizations + this lab's
   * connection only: no users, no invitations. Only creates — never updates or
   * links an existing client. Rows run one after another, one transaction
   * each; a bad row never stops the others.
   */
  async importClients(
    labTenantId: string,
    dto: ImportClientsDto,
    createdByUserId: string,
    requestId?: string
  ): Promise<ImportClientsResponse> {
    const startedAt = Date.now();
    const dryRun = dto.dryRun === true;
    const results: ImportRowResult[] = [];
    const candidates: {
      index: number;
      rowNumber: number;
      input: NewClinicInput;
    }[] = [];

    // Validation and duplicates within the request come first, before any
    // write. First row wins.
    const seenEmails = new Set<string>();
    const seenTaxKeys = new Set<string>();
    for (const raw of dto.rows) {
      const row = await validateImportRow(raw);
      if (!row.ok) {
        results.push({
          rowNumber: row.rowNumber,
          status: 'invalid',
          errors: row.errors,
        });
        continue;
      }

      const emailKey = clientEmailKey(row.input.email);
      const taxKey = clientTaxKey(row.input);
      const taxKeyStr = taxKey && taxKeyString(taxKey);
      if (
        seenEmails.has(emailKey) ||
        (taxKeyStr !== null && seenTaxKeys.has(taxKeyStr))
      ) {
        results.push({
          rowNumber: row.rowNumber,
          status: 'skipped',
          reason: 'DUPLICATE_IN_FILE',
        });
        continue;
      }
      seenEmails.add(emailKey);
      if (taxKeyStr !== null) seenTaxKeys.add(taxKeyStr);

      candidates.push({
        index: results.length,
        rowNumber: row.rowNumber,
        input: row.input,
      });
      results.push({ rowNumber: row.rowNumber, status: 'would_create' });
    }

    if (dryRun) {
      // Preview only: no locks, no writes. The real import checks again.
      const existing = await this.findExistingClientKeys(
        labTenantId,
        candidates.map((c) => c.input)
      );
      for (const c of candidates) {
        const taxKey = clientTaxKey(c.input);
        if (existing.emails.has(clientEmailKey(c.input.email))) {
          results[c.index] = {
            rowNumber: c.rowNumber,
            status: 'skipped',
            reason: 'EMAIL_EXISTS',
          };
        } else if (taxKey && existing.taxKeys.has(taxKeyString(taxKey))) {
          results[c.index] = {
            rowNumber: c.rowNumber,
            status: 'skipped',
            reason: 'TAX_ID_EXISTS',
          };
        }
      }
    } else {
      for (const c of candidates) {
        results[c.index] = await this.runImportRow(
          labTenantId,
          dto.importBatchId,
          c.rowNumber,
          c.input,
          createdByUserId,
          requestId
        );
      }
    }

    const count = (status: ImportRowResult['status']) =>
      results.filter((r) => r.status === status).length;
    const summary = {
      created: count('created'),
      wouldCreate: count('would_create'),
      skipped: count('skipped'),
      invalid: count('invalid'),
      conflict: count('conflict'),
      failed: count('failed'),
    };

    this.logger.log(
      `Client import lab=${labTenantId} batch=${dto.importBatchId} ` +
        `dryRun=${dryRun} rows=${dto.rows.length} ` +
        `created=${summary.created} skipped=${summary.skipped} ` +
        `invalid=${summary.invalid} conflict=${summary.conflict} ` +
        `failed=${summary.failed} durationMs=${Date.now() - startedAt} ` +
        `requestId=${requestId ?? '-'}`
    );

    return { results, summary };
  }

  async updateClient(
    labTenantId: string,
    clientTenantId: string,
    dto: UpdateClientDto
  ) {
    const connection = await this.verifyLabClientConnection(
      labTenantId,
      clientTenantId
    );

    const profile = buildClinicProfileUpdate({
      name: dto.name,
      email: dto.primaryContactEmail,
      primaryContactName: dto.primaryContactName,
      phone: dto.phone,
      address: dto.address,
      city: dto.city,
      country: dto.country,
      legalName: dto.legalName,
      taxIdType: dto.taxIdType,
      taxId: dto.taxId,
    });

    // Tax ID rules apply to the values after this update.
    if (
      profile.country !== undefined ||
      profile.taxIdType !== undefined ||
      profile.taxId !== undefined
    ) {
      const stored = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: clientTenantId },
        select: { country: true, taxIdType: true, taxId: true },
      });
      this.assertValidTaxIdentity({
        country:
          profile.country !== undefined ? profile.country : stored.country,
        taxIdType:
          profile.taxIdType !== undefined
            ? profile.taxIdType
            : stored.taxIdType,
        taxId: profile.taxId !== undefined ? profile.taxId : stored.taxId,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: clientTenantId },
        data: {
          ...profile,
          ...(dto.clientType !== undefined && {
            clientType: dto.clientType as ClientType,
          }),
        },
        select: {
          id: true,
          ...CLINIC_PROFILE_SELECT,
          clientType: true,
          clientStatus: true,
        },
      });

      // Keep this lab's pending invitations showing the clinic's current
      // contact email. Lookups use clinicTenantId, so this is display-only.
      if (profile.email) {
        await tx.onboardingToken.updateMany({
          where: this.pendingInvitationsWhere(labTenantId, clientTenantId),
          data: { clinicEmail: profile.email },
        });
      }

      // Notes belong to this lab's connection, not the shared profile.
      let notes = connection.notes;
      if (dto.notes !== undefined) {
        notes = dto.notes?.trim() || null;
        await tx.clinicLabConnection.update({
          where: { id: connection.id },
          data: { notes },
        });
      }

      return { ...updated, notes };
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
        where: this.pendingInvitationsWhere(labTenantId, clientTenantId),
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
          clinicTenantId: clientTenantId,
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

    const result = await this.prisma.onboardingToken.updateMany({
      where: this.pendingInvitationsWhere(labTenantId, clientTenantId),
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('No active invitation found to revoke.');
    }

    return { revoked: result.count };
  }

  async deleteClient(labTenantId: string, clientTenantId: string) {
    await this.verifyLabClientConnection(labTenantId, clientTenantId);

    // Deleting removes the clinic Tenant itself, which cascades to its
    // memberships, staff invitations, cases and orders (never to User rows).
    // So it is only allowed for a clinic that exists solely as this lab's
    // pending invitation. Guards and deletion share one transaction, and the
    // clinic row is locked first so a concurrent onboarding completion (which
    // updates this row before adding its membership) cannot slip in between.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${clientTenantId} FOR UPDATE`;

      const [otherLabConnections, memberCount, orderCount] = await Promise.all([
        tx.clinicLabConnection.count({
          where: { clinicId: clientTenantId, labId: { not: labTenantId } },
        }),
        tx.userTenantMembership.count({
          where: { tenantId: clientTenantId },
        }),
        tx.order.count({ where: { tenantId: clientTenantId } }),
      ]);
      if (otherLabConnections > 0) {
        throw new BadRequestException(
          'Cannot delete a client that is also connected to another laboratory. Suspend the client instead.'
        );
      }
      if (memberCount > 0) {
        throw new BadRequestException(
          'Cannot delete a client that has completed onboarding. Suspend the client instead.'
        );
      }
      if (orderCount > 0) {
        throw new BadRequestException(
          'Cannot delete a client with existing orders. Suspend the client instead.'
        );
      }

      await tx.onboardingToken.updateMany({
        where: this.pendingInvitationsWhere(labTenantId, clientTenantId),
        data: { revokedAt: new Date() },
      });
      await tx.clinicLabConnection.deleteMany({
        where: { clinicId: clientTenantId, labId: labTenantId },
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

  /**
   * Runs createClinicForLab in its own transaction. A unique violation aborts
   * the Postgres transaction, so it is never caught inside: the whole
   * transaction runs again, once, with a new slug suffix (plan A2).
   */
  private async runClinicCreate(
    labTenantId: string,
    input: NewClinicInput,
    opts: CreateClinicOptions
  ): Promise<CreateClinicOutcome> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            this.createClinicForLab(tx, labTenantId, input, {
              ...opts,
              forceSlugSuffix: attempt > 0,
            }),
          CLIENT_CREATE_TX_OPTIONS
        );
      } catch (err) {
        if (attempt === 0 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  }

  private async runImportRow(
    labTenantId: string,
    batchId: string,
    rowNumber: number,
    input: NewClinicInput,
    createdByUserId: string,
    requestId: string | undefined
  ): Promise<ImportRowResult> {
    try {
      const outcome = await this.runClinicCreate(labTenantId, input, {
        createdByUserId,
        withInvitation: false,
        importRow: { batchId, rowNumber },
      });
      switch (outcome.status) {
        case 'created':
          return { rowNumber, status: 'created', clientId: outcome.clientId };
        case 'skipped':
          return { rowNumber, status: 'skipped', reason: outcome.reason };
        case 'conflict':
          return { rowNumber, status: 'conflict', reason: outcome.reason };
      }
    } catch (err) {
      this.logger.error(
        `Client import row failed lab=${labTenantId} batch=${batchId} ` +
          `row=${rowNumber} error=${describeError(err)} ` +
          `requestId=${requestId ?? '-'}`
      );
      return { rowNumber, status: 'failed', reason: 'UNEXPECTED' };
    }
  }

  /**
   * The one place a client is created for a lab — Add client and every import
   * row (plan A2). Must run inside a transaction:
   *   1. per-lab advisory lock, so creations for the same lab queue up;
   *   2. import only: replay lookup by (lab, batch, row number);
   *   3. duplicate lookup among this lab's clients (email case-insensitive,
   *      or country + ID type + normalized ID);
   *   4. tenant, 5. connection, 6. onboarding token (withInvitation only).
   * Clinics connected only to other labs are never read or mentioned (A1).
   */
  private async createClinicForLab(
    tx: Prisma.TransactionClient,
    labTenantId: string,
    input: NewClinicInput,
    opts: CreateClinicOptions
  ): Promise<CreateClinicOutcome> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clinic-create:${labTenantId}`}, 0))`;

    const importRowHash = opts.importRow ? hashImportRow(input) : null;
    if (opts.importRow) {
      // By identity, not by email or tax ID: a retry is still recognized if
      // the client's profile was edited in between.
      const previous = await tx.clinicLabConnection.findFirst({
        where: {
          labId: labTenantId,
          importBatchId: opts.importRow.batchId,
          importRowNumber: opts.importRow.rowNumber,
        },
        select: { clinicId: true, importRowHash: true },
      });
      if (previous) {
        return previous.importRowHash === importRowHash
          ? { status: 'created', clientId: previous.clinicId }
          : { status: 'conflict', reason: 'BATCH_ROW_MISMATCH' };
      }
    }

    const taxKey = clientTaxKey(input);
    const match = await tx.tenant.findFirst({
      where: {
        type: 'CLINIC',
        clinicConnections: { some: { labId: labTenantId } },
        OR: [
          { email: { equals: input.email, mode: 'insensitive' } },
          ...(taxKey ? [taxKey] : []),
        ],
      },
      select: {
        id: true,
        email: true,
        clinicConnections: {
          where: { labId: labTenantId },
          select: { importBatchId: true },
        },
      },
    });
    if (match) {
      const sameBatch =
        opts.importRow !== undefined &&
        match.clinicConnections.some(
          (c) => c.importBatchId === opts.importRow?.batchId
        );
      const reason: SkipReason = sameBatch
        ? 'DUPLICATE_IN_FILE'
        : match.email &&
          clientEmailKey(match.email) === clientEmailKey(input.email)
        ? 'EMAIL_EXISTS'
        : 'TAX_ID_EXISTS';
      return { status: 'skipped', reason, clientId: match.id };
    }

    const tenant = await tx.tenant.create({
      data: {
        ...buildClinicProfileUpdate({
          name: input.name,
          email: input.email,
          primaryContactName: input.primaryContactName,
          phone: input.phone,
          address: input.address,
          city: input.city,
          country: input.country,
          legalName: input.legalName,
          taxIdType: input.taxIdType,
          taxId: input.taxId,
        }),
        name: input.name,
        slug: await this.newClinicSlug(tx, input.name, opts.forceSlugSuffix),
        type: 'CLINIC',
        clientType: input.clientType as ClientType,
        clientStatus: 'PENDING',
      },
    });

    await tx.clinicLabConnection.create({
      data: {
        clinicId: tenant.id,
        labId: labTenantId,
        isDefault: true,
        isActive: true,
        notes: input.notes ?? null,
        importBatchId: opts.importRow?.batchId ?? null,
        importRowNumber: opts.importRow?.rowNumber ?? null,
        importRowHash,
      },
    });

    if (!opts.withInvitation) {
      return { status: 'created', clientId: tenant.id };
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await tx.onboardingToken.create({
      data: {
        tokenHash: hashToken(rawToken),
        type: 'ADMIN',
        clinicName: input.name,
        clinicEmail: input.email,
        clientType: input.clientType as ClientType,
        laboratoryId: labTenantId,
        clinicTenantId: tenant.id,
        expiresAt,
        createdByUserId: opts.createdByUserId,
      },
    });

    return {
      status: 'created',
      clientId: tenant.id,
      invitation: { rawToken, expiresAt },
    };
  }

  /**
   * Tenant.slug is unique across KesherIO and the create lock is per lab, so
   * two labs can still collide: runClinicCreate retries with forceSuffix.
   */
  private async newClinicSlug(
    tx: Prisma.TransactionClient,
    name: string,
    forceSuffix = false
  ): Promise<string> {
    const base = slugify(name) || 'clinic';
    const taken =
      forceSuffix ||
      (await tx.tenant.findFirst({
        where: { slug: base },
        select: { id: true },
      }));
    return taken ? `${base}-${randomBytes(3).toString('hex')}` : base;
  }

  /** Dry run: this lab's clients matching any row's email or tax key. One query. */
  private async findExistingClientKeys(
    labTenantId: string,
    inputs: NewClinicInput[]
  ) {
    const emails = new Set<string>();
    const taxKeys = new Set<string>();
    if (inputs.length === 0) return { emails, taxKeys };

    const taxKeyFilters = inputs.flatMap((i) => {
      const key = clientTaxKey(i);
      return key ? [key] : [];
    });
    const existing = await this.prisma.tenant.findMany({
      where: {
        type: 'CLINIC',
        clinicConnections: { some: { labId: labTenantId } },
        OR: [
          ...inputs.map((i) => ({
            email: { equals: i.email, mode: 'insensitive' as const },
          })),
          ...taxKeyFilters,
        ],
      },
      select: {
        email: true,
        country: true,
        taxIdType: true,
        taxIdNormalized: true,
      },
    });

    for (const t of existing) {
      if (t.email) emails.add(clientEmailKey(t.email));
      if (t.country && t.taxIdType && t.taxIdNormalized) {
        taxKeys.add(
          taxKeyString({
            country: t.country,
            taxIdType: t.taxIdType,
            taxIdNormalized: t.taxIdNormalized,
          })
        );
      }
    }
    return { emails, taxKeys };
  }

  private assertValidTaxIdentity(input: {
    country?: string | null;
    taxIdType?: string | null;
    taxId?: string | null;
  }) {
    const errors: RowFieldError[] = checkTaxIdentity(input);
    if (errors.length > 0) {
      throw new BadRequestException(
        `Invalid tax ID: ${errors
          .map((e) => `${e.field} ${e.code}`)
          .join(', ')}.`
      );
    }
  }

  /** This lab's still-usable invitations for one clinic. */
  private pendingInvitationsWhere(labTenantId: string, clientTenantId: string) {
    return {
      laboratoryId: labTenantId,
      clinicTenantId: clientTenantId,
      used: false,
      revokedAt: null,
    };
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
