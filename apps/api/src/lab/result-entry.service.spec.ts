import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResultEntryService } from './result-entry.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';

describe('ResultEntryService — BLOCKED/CANCELLED guards', () => {
  let service: ResultEntryService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      orderedTest: { findFirst: jest.fn() },
      resultReportTest: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultEntryService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: {} },
      ],
    }).compile();

    service = module.get<ResultEntryService>(ResultEntryService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('getResultSession', () => {
    it('throws BadRequestException for BLOCKED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(service.getResultSession('test-1', 'lab-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws BadRequestException for CANCELLED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'CANCELLED',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(service.getResultSession('test-1', 'lab-1')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when test does not exist', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue(null);

      await expect(service.getResultSession('bad-id', 'lab-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('saveAnalytes', () => {
    it('throws BadRequestException for BLOCKED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for CANCELLED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'CANCELLED',
        order: {
          case: {
            patientSpecies: 'CANINE',
            patientAge: 5,
            patientAgeUnit: 'YEARS',
          },
        },
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('ResultEntryService — manually picked template', () => {
  let service: ResultEntryService;
  let prisma: Record<string, any>;
  let templateVersionService: { resolveTemplateForTest: jest.Mock };

  const bovineProgesterone = {
    id: 'ot-1',
    catalogItemCode: 'PROG',
    templateDefinitionId: 'def-dog',
    catalogItemName: 'Progesterone',
    status: 'READY',
    order: {
      id: 'order-1',
      case: {
        patientSpecies: 'BOVINE',
        patientAge: null,
        patientAgeUnit: null,
      },
      resultReport: null,
    },
  };

  beforeEach(async () => {
    prisma = {
      orderedTest: {
        findFirst: jest.fn().mockResolvedValue(bovineProgesterone),
      },
    };
    templateVersionService = {
      resolveTemplateForTest: jest.fn().mockResolvedValue({
        id: 'def-dog',
        activeVersion: {
          title: 'Progesterona canina',
          defaultObservations: null,
          observationPhrases: null,
          sections: [],
          analytes: [],
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultEntryService,
        { provide: PrismaService, useValue: prisma },
        { provide: TemplateVersionService, useValue: templateVersionService },
      ],
    }).compile();

    service = module.get<ResultEntryService>(ResultEntryService);
  });

  it('opens the result session with the template picked at accessioning', async () => {
    const session = await service.getResultSession('ot-1', 'lab-1');

    expect(templateVersionService.resolveTemplateForTest).toHaveBeenCalledWith(
      bovineProgesterone,
      'lab-1',
      'BOVINE',
      null
    );
    expect(session.template.title).toBe('Progesterona canina');
  });

  it('still 404s when neither a pick nor a species match exists', async () => {
    templateVersionService.resolveTemplateForTest.mockResolvedValue(null);

    await expect(service.getResultSession('ot-1', 'lab-1')).rejects.toThrow(
      NotFoundException
    );
  });
});
