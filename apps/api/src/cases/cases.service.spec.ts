import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { PrismaService } from '../prisma/prisma.service';
import { CaseStatus, PatientSpecies } from '@vet-ai/shared-types';
import type {
  CreateCaseDto,
  SendOrderDto,
  UploadResultsDto,
} from './dto/cases.dto';

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
    patientBreed: null,
    patientAge: null,
    patientAgeUnit: null,
    patientWeight: null,
    ownerName: 'Carlos Mendoza',
    ownerPhone: null,
    symptoms: null,
    triageResult: null,
    suggestedTests: null,
    selectedTests: null,
    orderNotes: null,
    orderSentAt: null,
    resultsUrl: null,
    resultsReceivedAt: null,
    createdByUserId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const CREATE_DTO: CreateCaseDto = {
  patientName: 'Luna',
  patientSpecies: PatientSpecies.DOG,
  ownerName: 'Carlos Mendoza',
};

const RESULTS_URL = 'https://storage.example.com/results/case-1.pdf';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    case: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
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
      providers: [CasesService, { provide: PrismaService, useValue: prisma }],
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
    it('returns the case when it exists in the tenant', async () => {
      const c = makeCase();
      prisma.case.findFirst.mockResolvedValue(c);

      const result = await service.findOne('tenant-1', 'case-1');

      expect(result).toEqual(c);
      expect(prisma.case.findFirst).toHaveBeenCalledWith({
        where: { id: 'case-1', tenantId: 'tenant-1' },
      });
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'nonexistent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('throws NotFoundException when the case belongs to a different tenant', async () => {
      // findFirst with tenantId scoping returns null — indistinguishable from not found
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

  // ── selectTests ────────────────────────────────────────────────────────────

  describe('selectTests', () => {
    it('saves selectedTests on an OPEN case and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );
      const updated = makeCase({ selectedTests: ['hemograma', 'alt'] });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.selectTests('tenant-1', 'case-1', {
        selectedTests: ['hemograma', 'alt'],
      });

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { selectedTests: ['hemograma', 'alt'] },
      });
    });

    it('replaces the existing selection on a TRIAGED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED, selectedTests: ['old-test'] })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ selectedTests: ['hemograma'] })
      );

      await service.selectTests('tenant-1', 'case-1', {
        selectedTests: ['hemograma'],
      });

      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { selectedTests: ['hemograma'] },
      });
    });

    it('throws BadRequestException when status is ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      await expect(
        service.selectTests('tenant-1', 'case-1', {
          selectedTests: ['hemograma'],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(
        service.selectTests('tenant-1', 'case-1', {
          selectedTests: ['hemograma'],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.selectTests('tenant-1', 'case-1', {
          selectedTests: ['hemograma'],
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

    it('stores triageResult and suggestedTests from the AI response', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ symptoms: 'Vomiting for 2 days' })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await service.runAiTriage('tenant-1', 'case-1');

      const updateData = prisma.case.update.mock.calls[0][0].data;
      expect(updateData).toHaveProperty('triageResult');
      expect(updateData).toHaveProperty('suggestedTests');
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
        makeCase({
          selectedTests: ['hemograma', 'alt'],
          status: CaseStatus.OPEN,
        })
      );
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
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.TRIAGED })
      );
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
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.OPEN })
      );
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
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.OPEN })
      );
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

    it('throws BadRequestException when selectedTests is null', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ selectedTests: null })
      );

      await expect(
        service.sendOrder('tenant-1', 'case-1', ORDER_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when selectedTests is an empty array', async () => {
      prisma.case.findFirst.mockResolvedValue(makeCase({ selectedTests: [] }));

      await expect(
        service.sendOrder('tenant-1', 'case-1', ORDER_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is not OPEN or TRIAGED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.ORDERED })
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

  // ── uploadResults ──────────────────────────────────────────────────────────

  describe('uploadResults', () => {
    const RESULTS_DTO: UploadResultsDto = { resultsUrl: RESULTS_URL };

    it('saves resultsUrl and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );
      const updated = makeCase({
        status: CaseStatus.ORDERED,
        resultsUrl: RESULTS_URL,
      });
      prisma.case.update.mockResolvedValue(updated);

      const result = await service.uploadResults(
        'tenant-1',
        'case-1',
        RESULTS_DTO
      );

      expect(result).toEqual(updated);
      expect(prisma.case.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resultsUrl: RESULTS_URL }),
        })
      );
    });

    it('sets resultsReceivedAt to the current timestamp (server-controlled)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );
      prisma.case.update.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED })
      );

      const before = new Date();
      await service.uploadResults('tenant-1', 'case-1', RESULTS_DTO);
      const after = new Date();

      const receivedAt: Date =
        prisma.case.update.mock.calls[0][0].data.resultsReceivedAt;
      expect(receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(receivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('throws BadRequestException when status is OPEN', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );

      await expect(
        service.uploadResults('tenant-1', 'case-1', RESULTS_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is TRIAGED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED })
      );

      await expect(
        service.uploadResults('tenant-1', 'case-1', RESULTS_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.COMPLETED })
      );

      await expect(
        service.uploadResults('tenant-1', 'case-1', RESULTS_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is CANCELLED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(
        service.uploadResults('tenant-1', 'case-1', RESULTS_DTO)
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the case does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadResults('tenant-1', 'case-1', RESULTS_DTO)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── completeCase ───────────────────────────────────────────────────────────

  describe('completeCase', () => {
    it('transitions ORDERED → COMPLETED and returns the updated case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED, resultsUrl: RESULTS_URL })
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

    it('throws BadRequestException when resultsUrl is null', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.ORDERED, resultsUrl: null })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
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
        makeCase({ status: CaseStatus.COMPLETED, resultsUrl: RESULTS_URL })
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
  //
  // All lookups use findFirst({ where: { id, tenantId } }).
  // A case in another tenant returns null — identical to not found.
  // This prevents tenants from probing each other's case IDs.

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

    it('selectTests returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.selectTests('tenant-2', 'case-1', {
          selectedTests: ['hemograma'],
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

    it('uploadResults returns NotFoundException for a case in another tenant', async () => {
      prisma.case.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadResults('tenant-2', 'case-1', { resultsUrl: RESULTS_URL })
      ).rejects.toThrow(NotFoundException);
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
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.OPEN })
      );
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
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.TRIAGED })
      );
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
        makeCase({ status: CaseStatus.ORDERED, resultsUrl: RESULTS_URL })
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
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.ORDERED })
      );

      await expect(service.sendOrder('tenant-1', 'case-1', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot send order when status is COMPLETED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.COMPLETED })
      );

      await expect(service.sendOrder('tenant-1', 'case-1', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot send order when status is CANCELLED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ selectedTests: ['hemograma'], status: CaseStatus.CANCELLED })
      );

      await expect(service.sendOrder('tenant-1', 'case-1', {})).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot complete a TRIAGED case (order step is missing)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.TRIAGED, resultsUrl: RESULTS_URL })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot complete a CANCELLED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED, resultsUrl: RESULTS_URL })
      );

      await expect(service.completeCase('tenant-1', 'case-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('cannot upload results before ORDERED', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.OPEN })
      );

      await expect(
        service.uploadResults('tenant-1', 'case-1', { resultsUrl: RESULTS_URL })
      ).rejects.toThrow(BadRequestException);
    });

    it('cannot upload results on a CANCELLED case', async () => {
      prisma.case.findFirst.mockResolvedValue(
        makeCase({ status: CaseStatus.CANCELLED })
      );

      await expect(
        service.uploadResults('tenant-1', 'case-1', { resultsUrl: RESULTS_URL })
      ).rejects.toThrow(BadRequestException);
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
