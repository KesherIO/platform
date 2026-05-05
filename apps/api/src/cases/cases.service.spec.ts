import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { PrismaService } from '../prisma/prisma.service';
import { TriageService } from '../triage/triage.service';
import { CaseStatus, PatientSpecies } from '@vet-ai/shared-types';
import type { CreateCaseDto, SendOrderDto } from './dto/cases.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    tenantId: 'tenant-1',
    status: CaseStatus.OPEN,
    patientName: 'Luna',
    patientSpecies: PatientSpecies.DOG,
    patientSex: null,
    patientBreed: null,
    patientDateOfBirth: null,
    patientAge: null,
    patientAgeUnit: null,
    patientWeight: null,
    ownerName: 'Carlos Mendoza',
    ownerPhone: null,
    symptoms: null,
    triageResult: null,
    suggestedCatalogItemIds: [],
    orderNotes: null,
    orderSentAt: null,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    selectedCatalogItems: [],
    ...overrides,
  };
}

const CREATE_DTO: CreateCaseDto = {
  patientName: 'Luna',
  patientSpecies: PatientSpecies.DOG,
  ownerName: 'Carlos Mendoza',
};


// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrismaMock() {
  const mock = {
    case: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    caseCatalogItem: {
      count: jest.fn().mockResolvedValue(1),
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
    catalogItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: typeof mock) => Promise<unknown>) =>
        cb(mock)
      ),
  };
  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CasesService', () => {
  let service: CasesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TriageService,
          useValue: {
            analyze: jest.fn().mockResolvedValue({
              diagnoses: [],
              suggestedCatalogItemIds: [],
            }),
          },
        },
      ],
    }).compile();

    service = module.get(CasesService);
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all cases for the tenant ordered by createdAt desc', async () => {
      const cases = [makeCase({ id: 'case-2' }), makeCase()];
      prisma.case.findMany.mockResolvedValue(cases);

      const result = await service.findAll('tenant-1', 'user-1');

      expect(result).toEqual(cases);
      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('returns an empty array when the tenant has no cases', async () => {
      prisma.case.findMany.mockResolvedValue([]);

      const result = await service.findAll('tenant-1', 'user-1');

      expect(result).toEqual([]);
    });

    it('scopes the query to the provided tenantId', async () => {
      prisma.case.findMany.mockResolvedValue([]);

      await service.findAll('tenant-99', 'user-1');

      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-99' }),
        })
      );
    });
  });

  // ── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the formatted case when it exists in the tenant', async () => {
      const c = makeCase();
      prisma.case.findFirst.mockResolvedValue(c);

      const result = await service.findOne('tenant-1', 'case-1');

      expect(result.id).toBe('case-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(prisma.case.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'case-1', tenantId: 'tenant-1' },
          include: expect.objectContaining({
            selectedCatalogItems: expect.anything(),
          }),
        })
      );
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException when the case belongs to a different tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-2', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── createCase ─────────────────────────────────────────────────────────────

  describe('createCase', () => {
    it('creates a case with status OPEN and returns it', async () => {
      const created = makeCase();
      prisma.case.create.mockResolvedValue(created);

      const result = await service.createCase('tenant-1', 'user-1', CREATE_DTO);

      expect(result).toEqual(created);
      expect(prisma.case.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.OPEN }),
        })
      );
    });

    it('scopes the case to the provided tenantId', async () => {
      prisma.case.create.mockResolvedValue(makeCase());

      await service.createCase('tenant-1', 'user-1', CREATE_DTO);

      expect(prisma.case.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: 'tenant-1' }),
        })
      );
    });

    it('sets createdByUserId to the authenticated user', async () => {
      prisma.case.create.mockResolvedValue(makeCase());

      await service.createCase('tenant-1', 'user-42', CREATE_DTO);

      expect(prisma.case.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdByUserId: 'user-42' }),
        })
      );
    });

    it('passes optional fields when provided', async () => {
      prisma.case.create.mockResolvedValue(makeCase());
      const dto: CreateCaseDto = {
        ...CREATE_DTO,
        patientBreed: 'Labrador',
        patientAge: 3,
        patientAgeUnit: 'YEARS' as CreateCaseDto['patientAgeUnit'],
        patientWeight: 28.5,
        ownerPhone: '+1 512 555 0100',
      };

      await service.createCase('tenant-1', 'user-1', dto);

      expect(prisma.case.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientBreed: 'Labrador',
            patientAge: 3,
            patientWeight: 28.5,
            ownerPhone: '+1 512 555 0100',
          }),
        })
      );
    });
  });

  // ── updatePatientInfo ──────────────────────────────────────────────────────

  describe('updatePatientInfo', () => {
    it('updates provided fields and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      const updated = makeCase({ patientName: 'Max' });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.updatePatientInfo('tenant-1', 'case-1', {
        patientName: 'Max',
      });

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { patientName: 'Max' },
      });
    });

    it('does not write fields absent from the body (true partial patch)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.case.update.mockResolvedValue(makeCase());

      await service.updatePatientInfo('tenant-1', 'case-1', {
        patientName: 'Max',
      });

      const updateData = prisma.case.update.mock.calls[0][0].data;
      expect(updateData).toHaveProperty('patientName', 'Max');
      expect(updateData).not.toHaveProperty('patientSpecies');
      expect(updateData).not.toHaveProperty('ownerName');
      expect(updateData).not.toHaveProperty('ownerPhone');
    });

    it('allows update in TRIAGED status', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await expect(
        service.updatePatientInfo('tenant-1', 'case-1', {
          ownerPhone: '+1 512 555 9999',
        })
      ).resolves.not.toThrow();
    });

    it('throws BadRequestException when status is ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await expect(
        service.updatePatientInfo('tenant-1', 'case-1', { patientName: 'Max' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(
        service.updatePatientInfo('tenant-1', 'case-1', { patientName: 'Max' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is CANCELLED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(
        service.updatePatientInfo('tenant-1', 'case-1', { patientName: 'Max' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when case belongs to a different tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePatientInfo('tenant-2', 'case-1', { patientName: 'Max' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── addSymptoms ────────────────────────────────────────────────────────────

  describe('addSymptoms', () => {
    it('saves symptom text and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      const updated = makeCase({
        symptoms: 'Vomiting for 2 days, loss of appetite',
      });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.addSymptoms('tenant-1', 'case-1', {
        symptoms: 'Vomiting for 2 days, loss of appetite',
      });

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { symptoms: 'Vomiting for 2 days, loss of appetite' },
      });
    });

    it('throws BadRequestException when status is TRIAGED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await expect(
        service.addSymptoms('tenant-1', 'case-1', { symptoms: 'Vomiting' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await expect(
        service.addSymptoms('tenant-1', 'case-1', { symptoms: 'Vomiting' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(
        service.addSymptoms('tenant-1', 'case-1', { symptoms: 'Vomiting' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.addSymptoms('tenant-1', 'case-1', { symptoms: 'Vomiting' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── selectCatalogItems ─────────────────────────────────────────────────────

  describe('selectCatalogItems', () => {
    const ITEM_IDS = ['item-1', 'item-2'];

    it('replaces the catalog item selection on an OPEN case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.catalogItem.findMany.mockResolvedValue([
        { id: 'item-1' },
        { id: 'item-2' },
      ]);
      const updatedRaw = makeCase({ status: CaseStatus.OPEN });
      prisma.case.findFirstOrThrow.mockResolvedValue(updatedRaw);

      const result = await service.selectCatalogItems('tenant-1', 'case-1', {
        selectedCatalogItemIds: ITEM_IDS,
      });

      expect(result.id).toBe('case-1');
      expect(prisma.caseCatalogItem.deleteMany).toHaveBeenCalledWith({
        where: { caseId: 'case-1' },
      });
      expect(prisma.caseCatalogItem.createMany).toHaveBeenCalledWith({
        data: ITEM_IDS.map((id) => ({ caseId: 'case-1', catalogItemId: id })),
      });
    });

    it('replaces the selection on a TRIAGED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );
      prisma.catalogItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.case.findFirstOrThrow.mockResolvedValue(makeCase());

      await expect(
        service.selectCatalogItems('tenant-1', 'case-1', {
          selectedCatalogItemIds: ['item-1'],
        })
      ).resolves.not.toThrow();
    });

    it('throws BadRequestException when one or more IDs are invalid', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      // Returns fewer items than requested — IDs are invalid or inactive
      prisma.catalogItem.findMany.mockResolvedValue([{ id: 'item-1' }]);

      await expect(
        service.selectCatalogItems('tenant-1', 'case-1', {
          selectedCatalogItemIds: ['item-1', 'item-invalid'],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await expect(
        service.selectCatalogItems('tenant-1', 'case-1', {
          selectedCatalogItemIds: ITEM_IDS,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(
        service.selectCatalogItems('tenant-1', 'case-1', {
          selectedCatalogItemIds: ITEM_IDS,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.selectCatalogItems('tenant-1', 'case-1', {
          selectedCatalogItemIds: ITEM_IDS,
        })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── runAiTriage ────────────────────────────────────────────────────────────

  describe('runAiTriage', () => {
    it('transitions OPEN → TRIAGED and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting for 2 days' })
      );
      const updated = makeCase({ status: CaseStatus.TRIAGED });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.runAiTriage('tenant-1', 'case-1');

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.TRIAGED }),
        })
      );
    });

    it('stores triageResult and suggestedCatalogItemIds from the AI response', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting for 2 days' })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await service.runAiTriage('tenant-1', 'case-1');

      const updateData = prisma.case.update.mock.calls[0][0].data;
      expect(updateData).toHaveProperty('triageResult');
      expect(updateData).toHaveProperty('suggestedCatalogItemIds');
    });

    it('throws BadRequestException when symptoms is null', async () => {
      prisma.case.findFirst.mockResolvedValue(makeCase({ symptoms: null }));

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when symptoms is an empty string', async () => {
      prisma.case.findFirst.mockResolvedValue(makeCase({ symptoms: '' }));

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when symptoms is only whitespace', async () => {
      prisma.case.findFirst.mockResolvedValue(makeCase({ symptoms: '   ' }));

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when status is not OPEN', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting', status: CaseStatus.TRIAGED })
      );

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── sendOrder ──────────────────────────────────────────────────────────────

  describe('sendOrder', () => {
    const ORDER_DTO: SendOrderDto = {
      orderNotes: 'Rush the parvovirus panel.',
    };

    it('transitions OPEN → ORDERED and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(2);
      const updated = makeCase({ status: CaseStatus.ORDERED });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.sendOrder('tenant-1', 'case-1', ORDER_DTO);

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.ORDERED }),
        })
      );
    });

    it('transitions TRIAGED → ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(1);
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await service.sendOrder('tenant-1', 'case-1', ORDER_DTO);

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.ORDERED }),
        })
      );
    });

    it('sets orderSentAt to the current timestamp (server-controlled)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(1);
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      const before = new Date();
      await service.sendOrder('tenant-1', 'case-1', ORDER_DTO);
      const after = new Date();

      const sentAt: Date = prisma.case.update.mock.calls[0][0].data.orderSentAt;
      expect(sentAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(sentAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('stores orderNotes from the body', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(1);
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await service.sendOrder('tenant-1', 'case-1', {
        orderNotes: 'Priority: parvovirus.',
      });

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderNotes: 'Priority: parvovirus.',
          }),
        })
      );
    });

    it('throws BadRequestException when no catalog items are selected', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(0);

      await expect(
        service.sendOrder('tenant-1', 'case-1', ORDER_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is not OPEN or TRIAGED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await expect(
        service.sendOrder('tenant-1', 'case-1', ORDER_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.sendOrder('tenant-1', 'case-1', ORDER_DTO)
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when case belongs to a different tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.sendOrder('tenant-2', 'case-1', {})).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── completeCase ───────────────────────────────────────────────────────────

  describe('completeCase', () => {
    it('transitions ORDERED → COMPLETED and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );
      const updated = makeCase({ status: CaseStatus.COMPLETED });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.completeCase('tenant-1', 'case-1');

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.COMPLETED }),
        })
      );
    });

    it('throws BadRequestException when status is not ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when already COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException when case belongs to a different tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.completeCase('tenant-2', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── cancelCase ─────────────────────────────────────────────────────────────

  describe('cancelCase', () => {
    it('cancels from OPEN and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      const updated = makeCase({ status: CaseStatus.CANCELLED });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.cancelCase('tenant-1', 'case-1');

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.CANCELLED }),
        })
      );
    });

    it('cancels from TRIAGED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await service.cancelCase('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.CANCELLED }),
        })
      );
    });

    it('cancels from ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await service.cancelCase('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.CANCELLED }),
        })
      );
    });

    it('throws BadRequestException when already COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(service.cancelCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException when already CANCELLED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(service.cancelCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.cancelCase('tenant-1', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // ── Tenant isolation ───────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('findOne returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-2', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('updatePatientInfo returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePatientInfo('tenant-2', 'case-1', { patientName: 'Max' })
      ).rejects.toThrow(NotFoundException);
    });

    it('addSymptoms returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.addSymptoms('tenant-2', 'case-1', { symptoms: 'Vomiting' })
      ).rejects.toThrow(NotFoundException);
    });

    it('selectCatalogItems returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.selectCatalogItems('tenant-2', 'case-1', {
          selectedCatalogItemIds: ['item-1'],
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('runAiTriage returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.runAiTriage('tenant-2', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('sendOrder returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.sendOrder('tenant-2', 'case-1', {})).rejects.toThrow(
        NotFoundException
      );
    });

    it('completeCase returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.completeCase('tenant-2', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('cancelCase returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.cancelCase('tenant-2', 'case-1')).rejects.toThrow(
        NotFoundException
      );
    });

    it('findAll scopes the query to the provided tenantId', async () => {
      prisma.case.findMany.mockResolvedValue([]);

      await service.findAll('tenant-1', 'user-1');

      expect(prisma.case.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1' }),
        })
      );
    });
  });

  // ── Valid status transitions ───────────────────────────────────────────────

  describe('valid status transitions', () => {
    it('OPEN → TRIAGED via runAiTriage', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting', status: CaseStatus.OPEN })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await service.runAiTriage('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.TRIAGED }),
        })
      );
    });

    it('OPEN → ORDERED via sendOrder (without AI)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(1);
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await service.sendOrder('tenant-1', 'case-1', {});

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.ORDERED }),
        })
      );
    });

    it('TRIAGED → ORDERED via sendOrder', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );
      prisma.caseCatalogItem.count.mockResolvedValue(1);
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await service.sendOrder('tenant-1', 'case-1', {});

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.ORDERED }),
        })
      );
    });

    it('ORDERED → COMPLETED via completeCase', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await service.completeCase('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.COMPLETED }),
        })
      );
    });

    it('OPEN → CANCELLED via cancelCase', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await service.cancelCase('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.CANCELLED }),
        })
      );
    });

    it('TRIAGED → CANCELLED via cancelCase', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await service.cancelCase('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.CANCELLED }),
        })
      );
    });

    it('ORDERED → CANCELLED via cancelCase', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await service.cancelCase('tenant-1', 'case-1');

      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CaseStatus.CANCELLED }),
        })
      );
    });
  });

  // ── Invalid status transitions ─────────────────────────────────────────────

  describe('invalid status transitions', () => {
    it('cannot run AI triage on a TRIAGED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting', status: CaseStatus.TRIAGED })
      );

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot run AI triage on an ORDERED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting', status: CaseStatus.ORDERED })
      );

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot run AI triage on a COMPLETED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting', status: CaseStatus.COMPLETED })
      );

      await expect(service.runAiTriage('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot send order when status is ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await expect(service.sendOrder('tenant-1', 'case-1', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot send order when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(service.sendOrder('tenant-1', 'case-1', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot send order when status is CANCELLED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(service.sendOrder('tenant-1', 'case-1', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot complete a TRIAGED case (order step is missing)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot complete a CANCELLED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot cancel an already COMPLETED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(service.cancelCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot cancel an already CANCELLED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(service.cancelCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });
  });
});
