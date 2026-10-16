import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { TenantContext } from '@vet-ai/shared-types';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';

describe('ResultsController — clinic release PDFs', () => {
  let controller: ResultsController;
  let resultsService: { clinicSeesAmendments: jest.Mock };
  let prisma: {
    order: { findFirst: jest.Mock };
    resultReportRelease: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
    resultReportReleaseArtifact: { findFirst: jest.Mock };
  };
  let storage: { downloadObject: jest.Mock };

  const tenant = { tenantId: 'clinic-1' } as TenantContext;
  const order = {
    id: 'order-1',
    requisitionNumber: 'REQ-001',
    labTenantId: 'lab-1',
    resultReport: { id: 'report-1' },
  };

  function mockResponse() {
    return { set: jest.fn(), end: jest.fn() } as unknown as Response & {
      set: jest.Mock;
      end: jest.Mock;
    };
  }

  beforeEach(async () => {
    resultsService = {
      clinicSeesAmendments: jest.fn().mockResolvedValue(true),
    };
    prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(order) },
      resultReportRelease: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      resultReportReleaseArtifact: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          storageUrl: 'lab-1/order-1/rel-2-clinic.pdf',
        }),
      },
    };
    storage = {
      downloadObject: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [
        { provide: ResultsService, useValue: resultsService },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(InternalApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ResultsController);
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  describe('getOrderReleases', () => {
    it('lists every release when the lab shows amendments', async () => {
      prisma.resultReportRelease.findMany.mockResolvedValue([
        {
          id: 'rel-2',
          releaseSequence: 2,
          releaseType: 'AMENDMENT',
          signerName: 'Dr. Lab',
          releasedAt: new Date('2026-10-16T09:00:00Z'),
          artifacts: [{ status: 'COMPLETED' }],
          tests: [{ catalogItemName: 'Química' }],
        },
      ]);

      const result = await controller.getOrderReleases(tenant, 'REQ-001');

      expect(resultsService.clinicSeesAmendments).toHaveBeenCalledWith('lab-1');
      expect(result.showAmendments).toBe(true);
      expect(result.currentReport).toBeNull();
      expect(result.releases).toEqual([
        expect.objectContaining({
          releaseType: 'AMENDMENT',
          pdfStatus: 'COMPLETED',
        }),
      ]);
    });

    it('returns only the current report when amendments are silent', async () => {
      resultsService.clinicSeesAmendments.mockResolvedValue(false);
      prisma.resultReportRelease.findFirst.mockResolvedValue({
        artifacts: [{ status: 'GENERATING' }],
      });

      const result = await controller.getOrderReleases(tenant, 'REQ-001');

      expect(result).toEqual({
        requisitionNumber: 'REQ-001',
        showAmendments: false,
        releases: [],
        currentReport: { pdfStatus: 'GENERATING' },
      });
      expect(prisma.resultReportRelease.findMany).not.toHaveBeenCalled();
      expect(prisma.resultReportRelease.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: 'report-1' },
          orderBy: { releaseSequence: 'desc' },
        })
      );
    });

    it('reports a missing current report as pending (before the backfill)', async () => {
      resultsService.clinicSeesAmendments.mockResolvedValue(false);
      prisma.resultReportRelease.findFirst.mockResolvedValue({ artifacts: [] });

      const result = await controller.getOrderReleases(tenant, 'REQ-001');

      expect(result.currentReport).toEqual({ pdfStatus: 'PENDING' });
    });

    it('throws NotFoundException for another clinic’s order', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        controller.getOrderReleases(tenant, 'REQ-001')
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { requisitionNumber: 'REQ-001', tenantId: 'clinic-1' },
        })
      );
    });
  });

  describe('downloadReleasePdf', () => {
    it('sends the release PDF when the lab shows amendments', async () => {
      prisma.resultReportRelease.findUnique.mockResolvedValue({ id: 'rel-1' });
      const res = mockResponse();

      await controller.downloadReleasePdf(tenant, 'REQ-001', '1', res);

      expect(prisma.resultReportReleaseArtifact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { releaseId: 'rel-1', artifactType: 'PDF' },
        })
      );
      expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
    });

    it('refuses any release PDF when amendments are silent', async () => {
      resultsService.clinicSeesAmendments.mockResolvedValue(false);

      await expect(
        controller.downloadReleasePdf(tenant, 'REQ-001', '1', mockResponse())
      ).rejects.toThrow(NotFoundException);
      expect(prisma.resultReportRelease.findUnique).not.toHaveBeenCalled();
      expect(storage.downloadObject).not.toHaveBeenCalled();
    });
  });

  describe('downloadCurrentReportPdf', () => {
    it("sends the newest release's current report", async () => {
      prisma.resultReportRelease.findFirst.mockResolvedValue({ id: 'rel-2' });
      const res = mockResponse();

      await controller.downloadCurrentReportPdf(tenant, 'REQ-001', res);

      expect(prisma.resultReportReleaseArtifact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { releaseId: 'rel-2', artifactType: 'CLINIC_REPORT_PDF' },
        })
      );
      expect(storage.downloadObject).toHaveBeenCalledWith(
        'lab-reports',
        'lab-1/order-1/rel-2-clinic.pdf'
      );
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': 'attachment; filename="REQ-001.pdf"',
        })
      );
    });

    it('throws NotFoundException while it is still generating', async () => {
      prisma.resultReportRelease.findFirst.mockResolvedValue({ id: 'rel-2' });
      prisma.resultReportReleaseArtifact.findFirst.mockResolvedValue({
        status: 'GENERATING',
        storageUrl: null,
      });

      await expect(
        controller.downloadCurrentReportPdf(tenant, 'REQ-001', mockResponse())
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException before anything is released', async () => {
      prisma.resultReportRelease.findFirst.mockResolvedValue(null);

      await expect(
        controller.downloadCurrentReportPdf(tenant, 'REQ-001', mockResponse())
      ).rejects.toThrow(NotFoundException);
    });
  });
});
