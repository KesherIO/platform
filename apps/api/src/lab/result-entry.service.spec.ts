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
        order: { case: { patientSpecies: 'CANINE', patientAge: 5, patientAgeUnit: 'YEARS' } },
      });

      await expect(
        service.getResultSession('test-1', 'lab-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for CANCELLED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'CANCELLED',
        order: { case: { patientSpecies: 'CANINE', patientAge: 5, patientAgeUnit: 'YEARS' } },
      });

      await expect(
        service.getResultSession('test-1', 'lab-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when test does not exist', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue(null);

      await expect(
        service.getResultSession('bad-id', 'lab-1')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('saveAnalytes', () => {
    it('throws BadRequestException for BLOCKED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'BLOCKED',
        blockReason: 'MISSING_SPECIMEN',
        order: { case: { patientSpecies: 'CANINE', patientAge: 5, patientAgeUnit: 'YEARS' } },
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for CANCELLED test', async () => {
      prisma.orderedTest.findFirst.mockResolvedValue({
        id: 'test-1',
        status: 'CANCELLED',
        order: { case: { patientSpecies: 'CANINE', patientAge: 5, patientAgeUnit: 'YEARS' } },
      });

      await expect(
        service.saveAnalytes('test-1', 'lab-1', [], 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });
  });
});
