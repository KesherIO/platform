import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReviewService } from './review.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusService } from './order-status.service';

describe('ReviewService', () => {
  let service: ReviewService;
  let prisma: Record<string, any>;
  let orderStatusService: { deriveAndPersist: jest.Mock };

  beforeEach(async () => {
    orderStatusService = {
      deriveAndPersist: jest.fn().mockResolvedValue({
        orderStatus: 'COMPLETED',
        caseStatus: 'COMPLETED',
        changed: true,
      }),
    };

    prisma = {
      order: { findFirst: jest.fn() },
      resultReport: { update: jest.fn().mockResolvedValue({}) },
      resultReportTest: { findMany: jest.fn().mockResolvedValue([]) },
      resultReportAnalyte: { update: jest.fn().mockResolvedValue({}) },
      orderedTest: { updateMany: jest.fn().mockResolvedValue({}) },
      timelineEvent: { create: jest.fn().mockResolvedValue({}) },
      case: { update: jest.fn().mockResolvedValue({}) },
      labSigner: { findUnique: jest.fn(), findMany: jest.fn() },
      laboratoryProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStatusService, useValue: orderStatusService },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('approveAndRelease', () => {
    const baseOrder = {
      id: 'order-1',
      caseId: 'case-1',
      orderedTests: [
        { id: 'test-1', status: 'IN_REVIEW' },
        { id: 'test-2', status: 'IN_REVIEW' },
      ],
      resultReport: { id: 'report-1', status: 'IN_REVIEW' },
    };

    it('calls deriveAndPersist after releasing all tests', async () => {
      prisma.order.findFirst.mockResolvedValue({ ...baseOrder });
      prisma.labSigner.findUnique
        .mockResolvedValueOnce({
          roles: ['REVIEWER'],
          laboratoryProfile: { tenantId: 'lab-1' },
        })
        .mockResolvedValueOnce({
          name: 'Dr. Smith',
          title: 'Pathologist',
          university: 'UVM',
          registrationNumber: '12345',
          signatureUrl: null,
        });

      const result = await service.approveAndRelease(
        'order-1', 'lab-1', 'signer-1', undefined, 'user-1', 'User'
      );

      expect(result.status).toBe('RELEASED');
      expect(orderStatusService.deriveAndPersist).toHaveBeenCalledWith('order-1');
    });

    it('throws when report is not IN_REVIEW', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        resultReport: { id: 'report-1', status: 'DRAFT' },
      });

      await expect(
        service.approveAndRelease('order-1', 'lab-1', 'signer-1', undefined, 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.approveAndRelease('order-1', 'lab-1', 'signer-1', undefined, 'user-1', 'User')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateReviewerAuthorization', () => {
    it('throws ForbiddenException when signer belongs to different lab', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        caseId: 'case-1',
        orderedTests: [{ id: 'test-1', status: 'IN_REVIEW' }],
        resultReport: { id: 'report-1', status: 'IN_REVIEW' },
      });
      prisma.labSigner.findUnique.mockResolvedValue({
        roles: ['REVIEWER'],
        laboratoryProfile: { tenantId: 'other-lab' },
      });

      await expect(
        service.approveAndRelease('order-1', 'lab-1', 'signer-1', undefined, 'user-1', 'User')
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when signer lacks REVIEWER role', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        caseId: 'case-1',
        orderedTests: [{ id: 'test-1', status: 'IN_REVIEW' }],
        resultReport: { id: 'report-1', status: 'IN_REVIEW' },
      });
      prisma.labSigner.findUnique.mockResolvedValue({
        roles: ['PROCESSOR'],
        laboratoryProfile: { tenantId: 'lab-1' },
      });

      await expect(
        service.approveAndRelease('order-1', 'lab-1', 'signer-1', undefined, 'user-1', 'User')
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
