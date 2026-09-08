import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { PickupService } from '../lab/pickup.service';
import { ReadinessService } from '../lab/readiness.service';
import { CaseStatus } from '@prisma/client';

const MOCK_CASE = {
  id: 'case-1',
  tenantId: 'tenant-1',
  status: CaseStatus.TRIAGED,
  attendingVetId: null,
};

const MOCK_CATALOG_ITEM = {
  id: 'ci-1',
  kind: 'TEST',
  code: 'CBC',
  name: 'Complete Blood Count',
  category: 'Hematology',
  turnaroundHours: 4,
};

const MOCK_ORDER = {
  id: 'order-1',
  requisitionNumber: 'REQ-2026-000001',
  status: 'PENDING',
  priority: 'ROUTINE',
  deliveryMethod: null,
  orderedItems: [],
  clinicNotes: null,
  orderingVetId: null,
  orderingVetName: null,
  orderingVetLicenseNumber: null,
  orderingVetIssuingAuthority: null,
  createdAt: new Date(),
};

const MOCK_MEMBERSHIP_VET = {
  userId: 'vet-user-1',
  tenantId: 'tenant-1',
  isOrderingVet: true,
  role: 'VET',
};

const MOCK_PROFILE = {
  id: 'profile-1',
  userId: 'vet-user-1',
  legalName: 'Dr. Ana López',
  credentials: [
    {
      id: 'cred-1',
      licenseNumber: 'MX-VET-12345',
      issuingCountry: 'MX',
      issuingAuthority: 'SENASICA',
      licenseExpiresAt: null,
      replacedAt: null,
    },
  ],
};

function makePrismaMock() {
  return {
    case: {
      findFirst: jest.fn().mockResolvedValue(MOCK_CASE),
      update: jest.fn().mockResolvedValue(MOCK_CASE),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(MOCK_ORDER),
    },
    caseCatalogItem: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ catalogItem: MOCK_CATALOG_ITEM }]),
    },
    clinicLabConnection: {
      findFirst: jest.fn().mockResolvedValue({ labId: 'lab-tenant-1' }),
    },
    counter: {
      upsert: jest
        .fn()
        .mockResolvedValue({ name: 'ORDER_SEQ:lab-tenant-1:2026', value: 1 }),
      update: jest.fn().mockResolvedValue({ value: 1 }),
    },
    timelineEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        pickupAddress: null,
        pickupContactName: null,
        pickupContactPhone: null,
        pickupInstructions: null,
      }),
    },
    userTenantMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    veterinarianProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    laboratoryProfile: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ vetVerificationRequired: false }),
    },
    vetLabVerification: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest
      .fn()
      .mockImplementation(
        (cb: (tx: ReturnType<typeof makePrismaMock>) => Promise<unknown>) =>
          cb(makePrismaMock())
      ),
  };
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let pickupService: { createPickup: jest.Mock };
  let readinessService: { checkBulkReadiness: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    pickupService = { createPickup: jest.fn().mockResolvedValue({}) };
    readinessService = {
      checkBulkReadiness: jest.fn().mockResolvedValue({
        items: [{ catalogItemId: 'ci-1', ready: true, reasons: [] }],
        summary: { total: 1, ready: 1, notReady: 0 },
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PickupService, useValue: pickupService },
        { provide: ReadinessService, useValue: readinessService },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  it('creates without error', () => {
    expect(service).toBeTruthy();
  });

  it('creates an order and returns formatted response', async () => {
    const result = await service.createOrderForCase('tenant-1', 'case-1', {});
    expect(result.status).toBe('PENDING');
    expect(result.requisitionNumber).toBe('REQ-2026-000001');
    expect(result.requisitionUrl).toContain('/api/orders/');
  });

  it('throws NotFoundException when case does not exist', async () => {
    prisma.case.findFirst.mockResolvedValue(null);
    await expect(
      service.createOrderForCase('tenant-1', 'bad-id', {})
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when case status is not orderable', async () => {
    prisma.case.findFirst.mockResolvedValue({
      ...MOCK_CASE,
      status: CaseStatus.ORDERED,
    });
    await expect(
      service.createOrderForCase('tenant-1', 'case-1', {})
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ConflictException when order already exists for case', async () => {
    prisma.order.findUnique.mockResolvedValue(MOCK_ORDER);
    await expect(
      service.createOrderForCase('tenant-1', 'case-1', {})
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when no catalog items are selected', async () => {
    prisma.caseCatalogItem.findMany.mockResolvedValue([]);
    await expect(
      service.createOrderForCase('tenant-1', 'case-1', {})
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects package with unready component, grouped by package', async () => {
    const pkgItem = {
      id: 'pkg-1',
      kind: 'PACKAGE',
      code: 'HEMO_PKG',
      name: 'Hemogram Panel',
      category: 'Hematology',
      turnaroundHours: 4,
    };
    prisma.caseCatalogItem.findMany.mockResolvedValue([
      { catalogItem: pkgItem },
    ]);
    prisma.catalogItemComposition = {
      findMany: jest.fn().mockResolvedValue([
        {
          packageId: 'pkg-1',
          component: { id: 'comp-1', name: 'Reticulocyte Count' },
        },
      ]),
    };
    readinessService.checkBulkReadiness.mockResolvedValue({
      items: [
        { catalogItemId: 'pkg-1', ready: true, reasons: [] },
        {
          catalogItemId: 'comp-1',
          ready: false,
          reasons: [
            { code: 'CATALOG_ITEM_INACTIVE', message: 'Item inactive' },
          ],
        },
      ],
      summary: { total: 2, ready: 1, notReady: 1 },
    });

    try {
      await service.createOrderForCase('tenant-1', 'case-1', {});
      fail('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as any;
      expect(response.packages).toBeDefined();
      expect(response.packages).toHaveLength(1);
      expect(response.packages[0].packageId).toBe('pkg-1');
      expect(response.packages[0].packageName).toBe('Hemogram Panel');
      expect(response.packages[0].unreadyComponents).toHaveLength(1);
      expect(response.packages[0].unreadyComponents[0].componentName).toBe(
        'Reticulocyte Count'
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Phase 4 — Ordering vet validation
  // ---------------------------------------------------------------------------

  describe('validateOrderingVet', () => {
    function setupValidVet() {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue(MOCK_PROFILE);
      prisma.laboratoryProfile.findUnique.mockResolvedValue({
        vetVerificationRequired: false,
      });
    }

    it('snapshots vet data into the order when orderingVetId is valid and lab does not require verification', async () => {
      setupValidVet();
      const orderCreate = jest.fn().mockResolvedValue({
        ...MOCK_ORDER,
        orderingVetId: 'vet-user-1',
        orderingVetName: 'Dr. Ana López',
        orderingVetLicenseNumber: 'MX-VET-12345',
        orderingVetIssuingAuthority: 'SENASICA',
      });

      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            counter: {
              upsert: jest.fn().mockResolvedValue({ value: 1 }),
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      await service.createOrderForCase('tenant-1', 'case-1', {
        orderingVetId: 'vet-user-1',
      });

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderingVetId: 'vet-user-1',
            orderingVetName: 'Dr. Ana López',
            orderingVetLicenseNumber: 'MX-VET-12345',
            orderingVetIssuingAuthority: 'SENASICA',
          }),
        })
      );
    });

    it('snapshots vet data when lab requires verification and vet is APPROVED', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue(MOCK_PROFILE);
      prisma.laboratoryProfile.findUnique.mockResolvedValue({
        vetVerificationRequired: true,
      });
      prisma.vetLabVerification.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });

      const orderCreate = jest.fn().mockResolvedValue(MOCK_ORDER);
      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            counter: {
              upsert: jest.fn().mockResolvedValue({ value: 1 }),
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      await service.createOrderForCase('tenant-1', 'case-1', {
        orderingVetId: 'vet-user-1',
      });

      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderingVetId: 'vet-user-1' }),
        })
      );
    });

    it('falls back to case.attendingVetId when orderingVetId is omitted from the DTO', async () => {
      prisma.case.findFirst.mockResolvedValue({
        ...MOCK_CASE,
        attendingVetId: 'vet-user-1',
      });
      setupValidVet();

      const orderCreate = jest.fn().mockResolvedValue(MOCK_ORDER);
      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            counter: {
              upsert: jest.fn().mockResolvedValue({ value: 1 }),
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      await service.createOrderForCase('tenant-1', 'case-1', {});

      expect(prisma.userTenantMembership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_tenantId: { userId: 'vet-user-1', tenantId: 'tenant-1' },
          },
        })
      );
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderingVetId: 'vet-user-1' }),
        })
      );
    });

    it('skips validation and sets null snapshot when no orderingVetId is resolvable', async () => {
      const orderCreate = jest.fn().mockResolvedValue(MOCK_ORDER);
      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            counter: {
              upsert: jest.fn().mockResolvedValue({ value: 1 }),
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      await service.createOrderForCase('tenant-1', 'case-1', {});

      expect(prisma.userTenantMembership.findUnique).not.toHaveBeenCalled();
      expect(orderCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderingVetId: null,
            orderingVetName: null,
            orderingVetLicenseNumber: null,
            orderingVetIssuingAuthority: null,
          }),
        })
      );
    });

    it('throws ORDERING_VET_NOT_MEMBER when the vet is not a member of the clinic', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(null);

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe('ORDERING_VET_NOT_MEMBER');
    });

    it('throws ORDERING_VET_NOT_A_VET when isOrderingVet is false', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...MOCK_MEMBERSHIP_VET,
        isOrderingVet: false,
      });

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe('ORDERING_VET_NOT_A_VET');
    });

    it('throws ORDERING_VET_NO_PROFILE when the vet has no VeterinarianProfile', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue(null);

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe('ORDERING_VET_NO_PROFILE');
    });

    it('throws ORDERING_VET_NO_CREDENTIAL when the profile has no active credential', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue({
        ...MOCK_PROFILE,
        credentials: [],
      });

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe(
        'ORDERING_VET_NO_CREDENTIAL'
      );
    });

    it('throws ORDERING_VET_LICENSE_EXPIRED when the license expiry date is in the past', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue({
        ...MOCK_PROFILE,
        credentials: [
          {
            ...MOCK_PROFILE.credentials[0],
            licenseExpiresAt: new Date('2020-01-01'),
          },
        ],
      });

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe(
        'ORDERING_VET_LICENSE_EXPIRED'
      );
    });

    it('throws ORDERING_VET_NOT_APPROVED when lab requires verification and status is PENDING', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue(MOCK_PROFILE);
      prisma.laboratoryProfile.findUnique.mockResolvedValue({
        vetVerificationRequired: true,
      });
      prisma.vetLabVerification.findUnique.mockResolvedValue({
        status: 'PENDING',
      });

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe('ORDERING_VET_NOT_APPROVED');
      expect((err.getResponse() as any).currentStatus).toBe('PENDING');
    });

    it('throws ORDERING_VET_NOT_APPROVED with NOT_SUBMITTED when no verification record exists', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue(
        MOCK_MEMBERSHIP_VET
      );
      prisma.veterinarianProfile.findUnique.mockResolvedValue(MOCK_PROFILE);
      prisma.laboratoryProfile.findUnique.mockResolvedValue({
        vetVerificationRequired: true,
      });
      prisma.vetLabVerification.findUnique.mockResolvedValue(null);

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe('ORDERING_VET_NOT_APPROVED');
      expect((err.getResponse() as any).currentStatus).toBe('NOT_SUBMITTED');
    });

    it('accepts a non-VET role (e.g. ADMIN) as ordering vet when isOrderingVet is true', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...MOCK_MEMBERSHIP_VET,
        role: 'ADMIN',
        isOrderingVet: true,
      });
      prisma.veterinarianProfile.findUnique.mockResolvedValue(MOCK_PROFILE);
      prisma.laboratoryProfile.findUnique.mockResolvedValue({
        vetVerificationRequired: false,
      });

      await expect(
        service.createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
      ).resolves.not.toThrow();
    });

    it('rejects ADMIN with isOrderingVet = false even with a profile', async () => {
      prisma.userTenantMembership.findUnique.mockResolvedValue({
        ...MOCK_MEMBERSHIP_VET,
        role: 'ADMIN',
        isOrderingVet: false,
      });

      const err = await service
        .createOrderForCase('tenant-1', 'case-1', {
          orderingVetId: 'vet-user-1',
        })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).code).toBe('ORDERING_VET_NOT_A_VET');
    });
  });

  // ---------------------------------------------------------------------------
  // Lab-scoped requisition numbering
  // ---------------------------------------------------------------------------

  describe('lab-scoped requisition numbering', () => {
    const CURRENT_YEAR = new Date().getUTCFullYear();

    it('uses ORDER_SEQ:{labTenantId}:{year} as the counter key', async () => {
      const counterUpsert = jest.fn().mockResolvedValue({ value: 1 });

      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            counter: {
              upsert: counterUpsert,
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(MOCK_ORDER),
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      await service.createOrderForCase('tenant-1', 'case-1', {});

      expect(counterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: `ORDER_SEQ:lab-tenant-1:${CURRENT_YEAR}` },
        })
      );
    });

    it('generates sequential numbers for the same lab and year', async () => {
      let callCount = 0;
      const counterUpsert = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ value: callCount });
      });
      const createdOrders: any[] = [];
      const orderCreate = jest.fn().mockImplementation((args: any) => {
        const order = {
          ...MOCK_ORDER,
          requisitionNumber: args.data.requisitionNumber,
        };
        createdOrders.push(order);
        return Promise.resolve(order);
      });

      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            counter: {
              upsert: counterUpsert,
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      prisma.order.findUnique.mockResolvedValue(null);

      await service.createOrderForCase('tenant-1', 'case-1', {});
      prisma.case.findFirst.mockResolvedValue({ ...MOCK_CASE, id: 'case-2' });
      await service.createOrderForCase('tenant-1', 'case-2', {});

      expect(counterUpsert).toHaveBeenCalledTimes(2);
      const key = `ORDER_SEQ:lab-tenant-1:${CURRENT_YEAR}`;
      expect(counterUpsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { name: key } })
      );
      expect(counterUpsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { name: key } })
      );
      expect(createdOrders[0].requisitionNumber).toBe(
        `REQ-${CURRENT_YEAR}-000001`
      );
      expect(createdOrders[1].requisitionNumber).toBe(
        `REQ-${CURRENT_YEAR}-000002`
      );
    });

    it('isolates counters between different labs', async () => {
      const counterUpsert = jest.fn().mockResolvedValue({ value: 1 });
      const orderCreate = jest.fn().mockResolvedValue(MOCK_ORDER);

      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            counter: {
              upsert: counterUpsert,
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      // Order to lab-A
      prisma.clinicLabConnection.findFirst.mockResolvedValue({
        labId: 'lab-A',
      });
      await service.createOrderForCase('tenant-1', 'case-1', {});

      // Order to lab-B
      prisma.clinicLabConnection.findFirst.mockResolvedValue({
        labId: 'lab-B',
      });
      prisma.case.findFirst.mockResolvedValue({ ...MOCK_CASE, id: 'case-2' });
      prisma.order.findUnique.mockResolvedValue(null);
      await service.createOrderForCase('tenant-1', 'case-2', {});

      expect(counterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: `ORDER_SEQ:lab-A:${CURRENT_YEAR}` },
        })
      );
      expect(counterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: `ORDER_SEQ:lab-B:${CURRENT_YEAR}` },
        })
      );
    });

    it('uses separate counter keys for different years (year rollover)', async () => {
      const counterUpsert = jest.fn().mockResolvedValue({ value: 1 });
      const orderCreate = jest.fn().mockResolvedValue(MOCK_ORDER);

      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            counter: {
              upsert: counterUpsert,
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: orderCreate,
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      // Order in current year
      await service.createOrderForCase('tenant-1', 'case-1', {});

      // Simulate year rollover
      const nextYear = CURRENT_YEAR + 1;
      jest.spyOn(Date.prototype, 'getUTCFullYear').mockReturnValue(nextYear);

      prisma.case.findFirst.mockResolvedValue({ ...MOCK_CASE, id: 'case-2' });
      prisma.order.findUnique.mockResolvedValue(null);
      await service.createOrderForCase('tenant-1', 'case-2', {});

      jest.restoreAllMocks();

      expect(counterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: `ORDER_SEQ:lab-tenant-1:${CURRENT_YEAR}` },
        })
      );
      expect(counterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: `ORDER_SEQ:lab-tenant-1:${nextYear}` },
        })
      );
    });

    it('falls back to __GLOBAL__ scope when no lab connection exists', async () => {
      prisma.clinicLabConnection.findFirst.mockResolvedValue(null);

      const counterUpsert = jest.fn().mockResolvedValue({ value: 1 });

      prisma.$transaction.mockImplementation(
        (cb: (tx: any) => Promise<unknown>) =>
          cb({
            ...makePrismaMock(),
            clinicLabConnection: {
              findFirst: jest.fn().mockResolvedValue(null),
            },
            counter: {
              upsert: counterUpsert,
              update: jest.fn().mockResolvedValue({ value: 1 }),
            },
            order: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(MOCK_ORDER),
            },
            case: { update: jest.fn().mockResolvedValue(MOCK_CASE) },
            timelineEvent: { create: jest.fn().mockResolvedValue({}) },
          })
      );

      await service.createOrderForCase('tenant-1', 'case-1', {});

      expect(counterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: `ORDER_SEQ:__GLOBAL__:${CURRENT_YEAR}` },
        })
      );
    });
  });
});
