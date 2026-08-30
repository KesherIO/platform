import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewService } from './review.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReviewService', () => {
  let service: ReviewService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      order: { findFirst: jest.fn() },
      resultReport: { update: jest.fn().mockResolvedValue({}) },
      resultReportTest: { updateMany: jest.fn().mockResolvedValue({}) },
      orderedTest: { updateMany: jest.fn().mockResolvedValue({}) },
      timelineEvent: { create: jest.fn().mockResolvedValue({}) },
      labSigner: { findMany: jest.fn() },
      laboratoryProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReviewService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('submitForReview', () => {
    const baseOrder = {
      id: 'order-1',
      orderedTests: [
        { id: 'ot-1', status: 'RESULTS_ENTERED', catalogItemName: 'Hemogram' },
        { id: 'ot-2', status: 'IN_PROGRESS', catalogItemName: 'Culture' },
      ],
      resultReport: { id: 'report-1', status: 'DRAFT' },
    };

    beforeEach(() => {
      prisma.laboratoryProfile.findUnique.mockResolvedValue({ id: 'lp-1' });
      prisma.labSigner.findMany.mockResolvedValue([
        { id: 'signer-1', name: 'Dr. S', roles: ['REVIEWER'] },
      ]);
    });

    it('submits all RESULTS_ENTERED tests when no testIds given', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);

      const result = await service.submitForReview(
        'order-1',
        'lab-1',
        'user-1',
        'User'
      );

      expect(result.status).toBe('IN_REVIEW');
      expect(prisma.orderedTest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ot-1'] } },
        })
      );
    });

    it('submits only specified testIds when provided', async () => {
      const order = {
        ...baseOrder,
        orderedTests: [
          {
            id: 'ot-1',
            status: 'RESULTS_ENTERED',
            catalogItemName: 'Hemogram',
          },
          { id: 'ot-2', status: 'RESULTS_ENTERED', catalogItemName: 'Culture' },
        ],
      };
      prisma.order.findFirst.mockResolvedValue(order);

      await service.submitForReview('order-1', 'lab-1', 'user-1', 'User', [
        'ot-1',
      ]);

      expect(prisma.orderedTest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ot-1'] } },
        })
      );
    });

    it('updates ResultReportTest status to IN_REVIEW', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);

      await service.submitForReview('order-1', 'lab-1', 'user-1', 'User');

      expect(prisma.resultReportTest.updateMany).toHaveBeenCalledWith({
        where: { orderedTestId: { in: ['ot-1'] } },
        data: { status: 'IN_REVIEW' },
      });
    });

    it('throws when no entered tests match', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        orderedTests: [
          { id: 'ot-1', status: 'IN_PROGRESS', catalogItemName: 'Hemogram' },
        ],
      });

      await expect(
        service.submitForReview('order-1', 'lab-1', 'user-1', 'User')
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.submitForReview('order-1', 'lab-1', 'user-1', 'User')
      ).rejects.toThrow(NotFoundException);
    });

    it('allows submit when report is RELEASED (partial release scenario)', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...baseOrder,
        resultReport: { id: 'report-1', status: 'RELEASED' },
      });

      const result = await service.submitForReview(
        'order-1',
        'lab-1',
        'user-1',
        'User'
      );

      expect(result.status).toBe('IN_REVIEW');
    });
  });

  describe('requestCorrections', () => {
    const baseOrder = {
      id: 'order-1',
      orderedTests: [
        { id: 'ot-1', status: 'IN_REVIEW' },
        { id: 'ot-2', status: 'IN_REVIEW' },
      ],
      resultReport: { id: 'report-1', status: 'IN_REVIEW' },
    };

    it('reverts ordered tests and resets ResultReportTest status to DRAFT', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);

      await service.requestCorrections(
        'order-1',
        'lab-1',
        'Fix WBC count',
        undefined,
        'user-1',
        'User'
      );

      expect(prisma.orderedTest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ot-1', 'ot-2'] } },
          data: expect.objectContaining({ status: 'RESULTS_ENTERED' }),
        })
      );
      expect(prisma.resultReportTest.updateMany).toHaveBeenCalledWith({
        where: { orderedTestId: { in: ['ot-1', 'ot-2'] } },
        data: { status: 'DRAFT' },
      });
    });

    it('throws when correction notes are empty', async () => {
      await expect(
        service.requestCorrections(
          'order-1',
          'lab-1',
          '',
          undefined,
          'user-1',
          'User'
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('reverts only specified testIds', async () => {
      prisma.order.findFirst.mockResolvedValue(baseOrder);

      await service.requestCorrections(
        'order-1',
        'lab-1',
        'Fix WBC',
        ['ot-1'],
        'user-1',
        'User'
      );

      expect(prisma.orderedTest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ot-1'] } },
        })
      );
    });
  });

  describe('getReviewerSigners', () => {
    it('returns empty array when no laboratory profile', async () => {
      prisma.laboratoryProfile.findUnique.mockResolvedValue(null);

      const result = await service.getReviewerSigners('lab-1');
      expect(result).toEqual([]);
    });

    it('returns reviewer signers', async () => {
      prisma.laboratoryProfile.findUnique.mockResolvedValue({ id: 'lp-1' });
      prisma.labSigner.findMany.mockResolvedValue([
        { id: 'signer-1', name: 'Dr. Smith', roles: ['REVIEWER'] },
      ]);

      const result = await service.getReviewerSigners('lab-1');
      expect(result).toHaveLength(1);
    });
  });
});
