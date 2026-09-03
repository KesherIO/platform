import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ListWorklistDto } from './dto/list-worklist.dto';
import type { TenantRole } from '@prisma/client';

const DEFAULT_PAGE_SIZE = 20;
const ACTIONABLE_STATUSES = ['READY', 'IN_PROGRESS'];
const PRIORITY_WEIGHT: Record<string, number> = {
  STAT: 0,
  URGENT: 1,
  ROUTINE: 2,
};

@Injectable()
export class WorklistService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorklist(
    labTenantId: string,
    query: ListWorklistDto,
    currentUserId?: string
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const statuses = query.status
      ? query.status.split(',')
      : ACTIONABLE_STATUSES;

    const where: Record<string, unknown> = {
      order: { labTenantId },
      status: { in: statuses },
    };

    if (query.department === '__none__') {
      where.department = null;
    } else if (query.department) {
      where.department = query.department;
    }

    if (query.assignmentFilter === 'unassigned') {
      where.assignedUserId = null;
    } else if (query.assignmentFilter === 'mine' && currentUserId) {
      where.assignedUserId = currentUserId;
    }

    if (query.search) {
      const s = query.search;
      where.OR = [
        { order: { requisitionNumber: { contains: s, mode: 'insensitive' } } },
        {
          order: {
            case: { patientName: { contains: s, mode: 'insensitive' } },
          },
        },
        { catalogItemName: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    const [items, total] = await Promise.all([
      this.prisma.orderedTest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          catalogItemName: true,
          catalogItemCode: true,
          status: true,
          department: true,
          processingMethod: true,
          version: true,
          claimedAt: true,
          startedAt: true,
          createdAt: true,
          blockReason: true,
          blockReasonDetail: true,
          assignedUserId: true,
          orderId: true,
          order: {
            select: {
              requisitionNumber: true,
              priority: true,
              status: true,
              case: {
                select: {
                  patientName: true,
                  patientSpecies: true,
                  ownerName: true,
                },
              },
              tenant: { select: { name: true } },
            },
          },
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
          analyzer: { select: { id: true, name: true } },
          specimens: {
            select: {
              specimen: { select: { accessionNumber: true } },
            },
            take: 1,
          },
          sources: {
            where: { sourceType: 'PACKAGE' },
            select: {
              originCatalogItemId: true,
              originName: true,
            },
            take: 1,
          },
        },
      }),
      this.prisma.orderedTest.count({ where }),
    ]);

    // Sort by priority weight (STAT first) then by createdAt
    items.sort((a, b) => {
      const wa = PRIORITY_WEIGHT[a.order.priority] ?? 2;
      const wb = PRIORITY_WEIGHT[b.order.priority] ?? 2;
      if (wa !== wb) return wa - wb;
      const aMine = a.assignedUserId === currentUserId ? 0 : 1;
      const bMine = b.assignedUserId === currentUserId ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const data = items.map((t) => ({
      id: t.id,
      catalogItemName: t.catalogItemName,
      catalogItemCode: t.catalogItemCode,
      status: t.status,
      department: t.department,
      processingMethod: t.processingMethod,
      version: t.version,
      claimedAt: t.claimedAt,
      startedAt: t.startedAt,
      createdAt: t.createdAt,
      blockReason: t.blockReason,
      blockReasonDetail: t.blockReasonDetail,
      orderId: t.orderId,
      requisitionNumber: t.order.requisitionNumber,
      orderPriority: t.order.priority,
      orderStatus: t.order.status,
      patientName: t.order.case.patientName,
      patientSpecies: t.order.case.patientSpecies,
      ownerName: t.order.case.ownerName,
      clinicName: t.order.tenant.name,
      assignedUserId: t.assignedUserId,
      assignedUserName: t.assignedTo
        ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}`
        : null,
      analyzerName: t.analyzer?.name ?? null,
      accessionNumber: t.specimens[0]?.specimen?.accessionNumber ?? null,
      packageOriginId: t.sources[0]?.originCatalogItemId ?? null,
      packageOriginName: t.sources[0]?.originName ?? null,
    }));

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getReadyCount(labTenantId: string) {
    const count = await this.prisma.orderedTest.count({
      where: {
        order: { labTenantId },
        status: 'READY',
        assignedUserId: null,
      },
    });
    return { count };
  }

  async getWorklistCounts(labTenantId: string) {
    const groups = await this.prisma.orderedTest.groupBy({
      by: ['department', 'status'],
      where: {
        order: { labTenantId },
        status: { in: ACTIONABLE_STATUSES as never },
        department: { not: null },
      },
      _count: true,
    });

    const noDeptGroups = await this.prisma.orderedTest.groupBy({
      by: ['status'],
      where: {
        order: { labTenantId },
        status: { in: ACTIONABLE_STATUSES as never },
        department: null,
      },
      _count: true,
    });

    const totalReady = await this.prisma.orderedTest.count({
      where: {
        order: { labTenantId },
        status: 'READY',
        assignedUserId: null,
      },
    });

    const deptMap = new Map<
      string,
      { ready: number; inProgress: number; total: number }
    >();

    for (const g of groups) {
      const dept = g.department as string;
      if (!deptMap.has(dept)) {
        deptMap.set(dept, { ready: 0, inProgress: 0, total: 0 });
      }
      const entry = deptMap.get(dept)!;
      entry.total += g._count;
      if (g.status === 'READY') entry.ready += g._count;
      if (g.status === 'IN_PROGRESS') entry.inProgress += g._count;
    }

    let noDept: { ready: number; inProgress: number; total: number } | null =
      null;
    if (noDeptGroups.length > 0) {
      noDept = { ready: 0, inProgress: 0, total: 0 };
      for (const g of noDeptGroups) {
        noDept.total += g._count;
        if (g.status === 'READY') noDept.ready += g._count;
        if (g.status === 'IN_PROGRESS') noDept.inProgress += g._count;
      }
    }

    const departments = Array.from(deptMap.entries()).map(([dept, counts]) => ({
      department: dept,
      ...counts,
    }));

    return { departments, totalReady, noDepartment: noDept };
  }

  async claimTest(
    labTenantId: string,
    testId: string,
    userId: string,
    expectedVersion: number
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
      },
    });

    if (!test) throw new NotFoundException('Test not found');

    if (test.status !== 'READY' && test.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot claim a test with status ${test.status}`
      );
    }

    if (test.assignedUserId) {
      throw new ConflictException('Test is already claimed by another user.');
    }

    // Atomic update with optimistic lock
    const updated = await this.prisma.orderedTest.updateMany({
      where: { id: testId, version: expectedVersion, assignedUserId: null },
      data: {
        assignedUserId: userId,
        claimedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Test was modified by another user. Please refresh.'
      );
    }

    return this.prisma.orderedTest.findUniqueOrThrow({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        claimedAt: true,
      },
    });
  }

  async unclaimTest(
    labTenantId: string,
    testId: string,
    userId: string,
    userRole: TenantRole
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        startedAt: true,
      },
    });

    if (!test) throw new NotFoundException('Test not found');

    if (!test.assignedUserId) {
      throw new BadRequestException('Test is not currently claimed.');
    }

    if (
      test.assignedUserId !== userId &&
      userRole !== 'ADMIN' &&
      userRole !== 'OWNER'
    ) {
      throw new ForbiddenException(
        'Only the assigned user or an admin can unclaim this test.'
      );
    }

    const data: Record<string, unknown> = {
      assignedUserId: null,
      claimedAt: null,
      version: { increment: 1 },
    };

    // If the test was started by the same user and is still IN_PROGRESS, revert to READY
    if (test.status === 'IN_PROGRESS' && test.assignedUserId === userId) {
      data.status = 'READY';
      data.startedAt = null;
    }

    await this.prisma.orderedTest.update({
      where: { id: testId },
      data,
    });

    return this.prisma.orderedTest.findUniqueOrThrow({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        claimedAt: true,
      },
    });
  }

  async startTest(labTenantId: string, testId: string, userId: string) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        orderId: true,
        status: true,
        assignedUserId: true,
        version: true,
        catalogItemName: true,
      },
    });

    if (!test) throw new NotFoundException('Test not found');

    if (test.status !== 'READY') {
      throw new BadRequestException(
        `Cannot start a test with status ${test.status}. Test must be READY.`
      );
    }

    if (test.assignedUserId !== userId) {
      throw new BadRequestException(
        'You must claim the test before starting it.'
      );
    }

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.orderedTest.update({
        where: { id: testId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: now,
          version: { increment: 1 },
        },
      }),
      this.prisma.timelineEvent.create({
        data: {
          orderId: test.orderId,
          eventType: 'PROCESSING_STARTED',
          actorId: userId,
          actorName: '',
          description: `Processing started for ${test.catalogItemName}`,
          metadata: { orderedTestId: testId },
        },
      }),
    ]);

    // Derive order status — starting a test moves order to PROCESSING
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: test.orderId },
      select: { status: true },
    });

    if (
      order.status !== 'PROCESSING' &&
      order.status !== 'COMPLETED' &&
      order.status !== 'CANCELLED'
    ) {
      await this.prisma.order.update({
        where: { id: test.orderId },
        data: { status: 'PROCESSING', processingStartedAt: now },
      });
    }

    return this.prisma.orderedTest.findUniqueOrThrow({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        startedAt: true,
      },
    });
  }

  async reassignTest(
    labTenantId: string,
    testId: string,
    targetUserId: string,
    expectedVersion: number
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: { id: true, version: true, status: true },
    });

    if (!test) throw new NotFoundException('Test not found');

    if (test.status !== 'READY' && test.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot reassign a test with status ${test.status}`
      );
    }

    // Validate target user is a lab member with an appropriate role
    const membership = await this.prisma.userTenantMembership.findUnique({
      where: {
        userId_tenantId: { userId: targetUserId, tenantId: labTenantId },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new BadRequestException(
        'Target user is not a member of this laboratory.'
      );
    }

    const allowedRoles = new Set(['TECHNICIAN', 'ADMIN', 'OWNER']);
    if (!allowedRoles.has(membership.role)) {
      throw new BadRequestException(
        'Target user does not have a role that can be assigned tests.'
      );
    }

    // Atomic update with optimistic lock
    const updated = await this.prisma.orderedTest.updateMany({
      where: { id: testId, version: expectedVersion },
      data: {
        assignedUserId: targetUserId,
        claimedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Test was modified by another user. Please refresh.'
      );
    }

    return this.prisma.orderedTest.findUniqueOrThrow({
      where: { id: testId },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        claimedAt: true,
      },
    });
  }

  async batchClaimTests(
    labTenantId: string,
    tests: { testId: string; version: number }[],
    userId: string
  ) {
    const testIds = tests.map((t) => t.testId);
    const versionMap = new Map(tests.map((t) => [t.testId, t.version]));

    const found = await this.prisma.orderedTest.findMany({
      where: { id: { in: testIds }, order: { labTenantId } },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
      },
    });

    if (found.length !== testIds.length) {
      throw new NotFoundException('One or more tests not found');
    }

    for (const test of found) {
      if (test.status !== 'READY' && test.status !== 'IN_PROGRESS') {
        throw new BadRequestException(
          `Cannot claim test ${test.id} with status ${test.status}`
        );
      }
      if (test.assignedUserId) {
        throw new ConflictException(
          `Test ${test.id} is already claimed by another user.`
        );
      }
    }

    const now = new Date();

    await this.prisma.$transaction(
      found.map((test) =>
        this.prisma.orderedTest.updateMany({
          where: {
            id: test.id,
            version: versionMap.get(test.id),
            assignedUserId: null,
          },
          data: {
            assignedUserId: userId,
            claimedAt: now,
            version: { increment: 1 },
          },
        })
      )
    );

    return this.prisma.orderedTest.findMany({
      where: { id: { in: testIds } },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        claimedAt: true,
      },
    });
  }

  async batchStartTests(
    labTenantId: string,
    testIds: string[],
    userId: string
  ) {
    const found = await this.prisma.orderedTest.findMany({
      where: { id: { in: testIds }, order: { labTenantId } },
      select: {
        id: true,
        orderId: true,
        status: true,
        assignedUserId: true,
        version: true,
        catalogItemName: true,
      },
    });

    if (found.length !== testIds.length) {
      throw new NotFoundException('One or more tests not found');
    }

    for (const test of found) {
      if (test.status !== 'READY') {
        throw new BadRequestException(
          `Cannot start test ${test.id} with status ${test.status}. Test must be READY.`
        );
      }
      if (test.assignedUserId !== userId) {
        throw new BadRequestException(
          `You must claim test ${test.id} before starting it.`
        );
      }
    }

    const now = new Date();
    const orderId = found[0].orderId;

    await this.prisma.$transaction([
      ...found.map((test) =>
        this.prisma.orderedTest.update({
          where: { id: test.id },
          data: {
            status: 'IN_PROGRESS',
            startedAt: now,
            version: { increment: 1 },
          },
        })
      ),
      ...found.map((test) =>
        this.prisma.timelineEvent.create({
          data: {
            orderId: test.orderId,
            eventType: 'PROCESSING_STARTED',
            actorId: userId,
            actorName: '',
            description: `Processing started for ${test.catalogItemName}`,
            metadata: { orderedTestId: test.id },
          },
        })
      ),
    ]);

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });

    if (
      order.status !== 'PROCESSING' &&
      order.status !== 'COMPLETED' &&
      order.status !== 'CANCELLED'
    ) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'PROCESSING', processingStartedAt: now },
      });
    }

    return this.prisma.orderedTest.findMany({
      where: { id: { in: testIds } },
      select: {
        id: true,
        status: true,
        assignedUserId: true,
        version: true,
        startedAt: true,
      },
    });
  }
}
