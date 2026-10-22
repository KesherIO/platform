import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import type { PrismaService } from '../prisma/prisma.service';
import type { InstrumentProcessorService } from './instrument-processor.service';
import { InstrumentReviewService } from './instrument-review.service';

describe('InstrumentReviewService', () => {
  const prisma = {
    instrumentMessage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    instrumentSampleLink: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    instrumentParameterMapping: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    analyzer: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
  };
  const processor = { process: jest.fn() };
  const service = new InstrumentReviewService(
    prisma as unknown as PrismaService,
    processor as unknown as InstrumentProcessorService
  );
  const msg = (over = {}) => ({
    id: 'm1',
    status: 'UNMATCHED',
    reasons: [],
    resolvedAt: null,
    analyzerId: 'an1',
    sampleId: '168',
    isComplete: true,
    observationTime: new Date('2026-10-20T00:14:57Z'),
    receivedAtConnector: new Date('2026-10-20T00:15:00Z'),
    ...over,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    processor.process.mockResolvedValue('IMPORTED');
    prisma.analyzer.findFirst.mockResolvedValue({ id: 'an1' });
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      status: 'RECEIVED_BY_LAB',
    });
    prisma.instrumentSampleLink.findMany.mockResolvedValue([]);
    prisma.instrumentSampleLink.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'l1', ...data })
    );
    prisma.instrumentMessage.update.mockResolvedValue({});
  });

  describe('queue', () => {
    it("always filters by the caller's lab; review excludes resolved items and incomplete transfers", async () => {
      prisma.instrumentMessage.findMany.mockResolvedValue([]);
      await service.list('lab1', 'review');
      expect(prisma.instrumentMessage.findMany.mock.calls[0][0].where).toEqual({
        labTenantId: 'lab1',
        resolvedAt: null,
        status: { in: ['UNMATCHED', 'AMBIGUOUS', 'NEEDS_REVIEW', 'FAILED'] },
      });
      await service.list('lab1', 'incomplete');
      expect(prisma.instrumentMessage.findMany.mock.calls[1][0].where).toEqual({
        labTenantId: 'lab1',
        resolvedAt: null,
        status: 'INCOMPLETE',
      });
    });
    it('paginates with a cursor', async () => {
      prisma.instrumentMessage.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      expect(await service.list('lab1', 'all', 2)).toEqual({
        items: [{ id: 'a' }, { id: 'b' }],
        nextCursor: 'b',
      });
    });
    it("get/raw are 404 for another lab's message", async () => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(null);
      await expect(service.get('lab2', 'm1')).rejects.toThrow(
        NotFoundException
      );
      await expect(service.raw('lab2', 'm1')).rejects.toThrow(
        NotFoundException
      );
      expect(prisma.instrumentMessage.findFirst.mock.calls[0][0].where).toEqual(
        { id: 'm1', labTenantId: 'lab2' }
      );
    });
    it('raw returns the exact original bytes', async () => {
      const bytes = Buffer.from([0, 0, 0, 5, 0x0b, 1, 2, 0x1c, 0x0d]);
      prisma.instrumentMessage.findFirst.mockResolvedValue({
        sha256: 'ab'.repeat(32),
        sampleId: '168',
        controlId: '2577',
        payload: { compression: 'gzip', bytes: gzipSync(bytes) },
      });
      const out = await service.raw('lab1', 'm1');
      expect(out.bytes.equals(bytes)).toBe(true);
      expect(out.fileName).toBe('vh30-168-2577-abababab.frame');
    });
  });

  describe('get: mapping preview under the CURRENT mappings (partial mapping is visible)', () => {
    const parsed = {
      patient: { sampleId: '168', name: null, speciesText: null, sex: null },
      images: [],
      parameters: [
        {
          code: 'WBC',
          valueType: 'NM',
          value: '13.23',
          unit: '10^9/L',
          referenceRange: '',
          abnormalFlag: '',
          userFlag: '',
        },
        {
          code: 'HGB',
          valueType: 'NM',
          value: '57',
          unit: 'g/L',
          referenceRange: '',
          abnormalFlag: '',
          userFlag: '',
        },
        {
          code: 'Mid#',
          valueType: 'NM',
          value: '1.2',
          unit: '10^9/L',
          referenceRange: '',
          abnormalFlag: '',
          userFlag: '',
        },
        {
          code: 'WBC Alarm',
          valueType: 'IS',
          value: 'x',
          unit: '',
          referenceRange: '',
          abnormalFlag: '',
          userFlag: '',
        },
      ],
    };
    const base = {
      id: 'm1',
      labTenantId: 'lab1',
      analyzerId: 'an1',
      sampleId: '168',
      isComplete: true,
      parsed,
      analyzer: { id: 'an1', name: 'VH30' },
      order: null,
    };
    beforeEach(() => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(base);
      prisma.instrumentMessage.findMany.mockResolvedValue([]);
    });

    it('reports what imports, what is not mapped, and what is in an unmapped unit', async () => {
      prisma.instrumentParameterMapping.findMany.mockResolvedValue([
        {
          parameterCode: 'WBC',
          analyzerUnit: '10^9/L',
          catalogItemCode: 'CBC',
          analyteCode: 'WBC',
          multiplier: 1,
        },
        {
          parameterCode: 'HGB',
          analyzerUnit: 'g/dL',
          catalogItemCode: 'CBC',
          analyteCode: 'HGB',
          multiplier: 1,
        },
      ]);
      const { mappingPreview: p } = await service.get('lab1', 'm1');
      expect(p).toMatchObject({
        numericParameters: 3,
        isPartial: true,
        notMapped: ['Mid#'],
      });
      expect(p?.importable.map((i) => i.analyteCode)).toEqual(['WBC']);
      expect(p?.unitMismatches).toEqual([
        { code: 'HGB', unit: 'g/L', mappedUnits: ['g/dL'] },
      ]);
      expect(prisma.instrumentParameterMapping.findMany).toHaveBeenCalledWith({
        where: { labTenantId: 'lab1', analyzerId: 'an1' },
      });
    });

    it('is not partial when every numeric value maps, and absent for an interrupted transfer', async () => {
      prisma.instrumentParameterMapping.findMany.mockResolvedValue(
        ['WBC', 'Mid#']
          .map((c) => ({
            parameterCode: c,
            analyzerUnit: '10^9/L',
            catalogItemCode: 'CBC',
            analyteCode: c,
            multiplier: 1,
          }))
          .concat([
            {
              parameterCode: 'HGB',
              analyzerUnit: 'g/L',
              catalogItemCode: 'CBC',
              analyteCode: 'HGB',
              multiplier: 0.1,
            },
          ])
      );
      expect((await service.get('lab1', 'm1')).mappingPreview?.isPartial).toBe(
        false
      );
      prisma.instrumentMessage.findFirst.mockResolvedValue({
        ...base,
        isComplete: false,
        parsed: null,
      });
      expect((await service.get('lab1', 'm1')).mappingPreview).toBeNull();
    });
  });

  describe('resolveSample', () => {
    it('creates an explicit REVIEW link around the run, then reprocesses', async () => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(msg());
      expect(await service.resolveSample('lab1', 'm1', 'o1', 'u1')).toEqual({
        id: 'm1',
        status: 'IMPORTED',
      });
      expect(
        prisma.instrumentSampleLink.create.mock.calls[0][0].data
      ).toMatchObject({
        labTenantId: 'lab1',
        analyzerId: 'an1',
        sampleId: '168',
        orderId: 'o1',
        createdVia: 'REVIEW',
        createdById: 'u1',
        validFrom: new Date('2026-10-19T23:14:57Z'),
        validUntil: new Date('2026-10-21T00:14:57Z'),
      });
      expect(processor.process).toHaveBeenCalledWith('m1');
    });
    it("refuses incomplete transfers, finished messages, and another lab's order", async () => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({ isComplete: false, status: 'INCOMPLETE' })
      );
      await expect(
        service.resolveSample('lab1', 'm1', 'o1', 'u1')
      ).rejects.toThrow(BadRequestException);
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({ status: 'IMPORTED' })
      );
      await expect(
        service.resolveSample('lab1', 'm1', 'o1', 'u1')
      ).rejects.toThrow(ConflictException);
      prisma.instrumentMessage.findFirst.mockResolvedValue(msg());
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveSample('lab1', 'm1', 'other-lab-order', 'u1')
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.findFirst).toHaveBeenLastCalledWith({
        where: { id: 'other-lab-order', labTenantId: 'lab1' },
        select: { id: true, status: true },
      });
      expect(processor.process).not.toHaveBeenCalled();
    });
  });

  describe('links', () => {
    const dto = { analyzerId: 'an1', sampleId: ' 168 ', orderId: 'o1' };
    it('trims the sample ID and defaults to a 24 h window from now', async () => {
      await service.createLink('lab1', dto, 'u1');
      const d = prisma.instrumentSampleLink.create.mock.calls[0][0].data;
      expect(d.sampleId).toBe('168');
      expect(d.validUntil.getTime() - d.validFrom.getTime()).toBe(
        24 * 3_600_000
      );
    });
    it('reuses an overlapping link to the same order; refuses a different order', async () => {
      prisma.instrumentSampleLink.findMany.mockResolvedValue([
        { id: 'existing', orderId: 'o1' },
      ]);
      expect(await service.createLink('lab1', dto, 'u1')).toMatchObject({
        id: 'existing',
      });
      expect(prisma.instrumentSampleLink.create).not.toHaveBeenCalled();
      prisma.instrumentSampleLink.findMany.mockResolvedValue([
        { id: 'existing', orderId: 'other' },
      ]);
      await expect(service.createLink('lab1', dto, 'u1')).rejects.toThrow(
        ConflictException
      );
    });
    it('rejects an inverted window, an analyzer or order outside the lab, and a cancelled order', async () => {
      await expect(
        service.createLink(
          'lab1',
          {
            ...dto,
            validFrom: new Date('2026-10-21'),
            validUntil: new Date('2026-10-20'),
          },
          'u1'
        )
      ).rejects.toThrow(BadRequestException);
      prisma.analyzer.findFirst.mockResolvedValue(null);
      await expect(service.createLink('lab1', dto, 'u1')).rejects.toThrow(
        NotFoundException
      );
      prisma.analyzer.findFirst.mockResolvedValue({ id: 'an1' });
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        status: 'CANCELLED',
      });
      await expect(service.createLink('lab1', dto, 'u1')).rejects.toThrow(
        BadRequestException
      );
      expect(prisma.analyzer.findFirst.mock.calls[0][0].where).toEqual({
        id: 'an1',
        labTenantId: 'lab1',
      });
    });
    it('endLink is scoped to the lab', async () => {
      prisma.instrumentSampleLink.findFirst.mockResolvedValue(null);
      await expect(service.endLink('lab2', 'l1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('approve / reprocess / dismiss', () => {
    const actor = { id: 'u1', name: 'Rev' };
    it('approve needs every approvable open reason, and refuses when nothing is approvable', async () => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({
          status: 'NEEDS_REVIEW',
          reasons: ['CONTENT_CHANGED', 'EXPIRED_REAGENT'],
        })
      );
      await expect(
        service.approve('lab1', 'm1', actor, ['CONTENT_CHANGED'], 'note')
      ).rejects.toThrow(/every approvable reason/);
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({ status: 'NEEDS_REVIEW', reasons: ['UNIT_MISMATCH:HGB:g/L'] })
      );
      await expect(
        service.approve('lab1', 'm1', actor, ['CONTENT_CHANGED'], 'note')
      ).rejects.toThrow(/Nothing in this message can be approved/);
      expect(processor.process).not.toHaveBeenCalled();
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({
          status: 'NEEDS_REVIEW',
          reasons: ['CONTENT_CHANGED', 'EXPIRED_REAGENT'],
        })
      );
      await service.approve(
        'lab1',
        'm1',
        actor,
        ['CONTENT_CHANGED', 'EXPIRED_REAGENT'],
        'Verified'
      );
      expect(processor.process).toHaveBeenCalledWith('m1', {
        approved: ['CONTENT_CHANGED', 'EXPIRED_REAGENT'],
        actor,
      });
      expect(
        prisma.instrumentMessage.update.mock.calls[0][0].data
      ).toMatchObject({ reviewedById: 'u1', reviewNote: 'Verified' });
    });
    it('approve only applies to NEEDS_REVIEW; reprocess never to IMPORTED/DUPLICATE/INCOMPLETE', async () => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({ status: 'UNMATCHED', reasons: ['UNMATCHED'] })
      );
      await expect(
        service.approve('lab1', 'm1', actor, ['CONTENT_CHANGED'], 'x')
      ).rejects.toThrow(ConflictException);
      for (const status of [
        'IMPORTED',
        'DUPLICATE',
        'INCOMPLETE',
        'DISMISSED',
      ]) {
        prisma.instrumentMessage.findFirst.mockResolvedValue(msg({ status }));
        await expect(service.reprocess('lab1', 'm1')).rejects.toThrow(
          ConflictException
        );
      }
    });
    it('dismiss marks a review item DISMISSED but only acknowledges an INCOMPLETE one', async () => {
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({ status: 'UNMATCHED' })
      );
      expect(await service.dismiss('lab1', 'm1', 'u1', 'Not ours')).toEqual({
        id: 'm1',
        status: 'DISMISSED',
      });
      expect(
        prisma.instrumentMessage.update.mock.calls[0][0].data
      ).toMatchObject({ status: 'DISMISSED', reviewNote: 'Not ours' });
      prisma.instrumentMessage.findFirst.mockResolvedValue(
        msg({ status: 'INCOMPLETE', isComplete: false })
      );
      expect(await service.dismiss('lab1', 'm1', 'u1', 'Cable out')).toEqual({
        id: 'm1',
        status: 'INCOMPLETE',
      });
      expect(
        prisma.instrumentMessage.update.mock.calls[1][0].data.status
      ).toBeUndefined();
    });
  });

  describe('mappings', () => {
    it('upsert checks the analyzer belongs to the lab and defaults the multiplier to 1', async () => {
      prisma.instrumentParameterMapping.upsert.mockResolvedValue({});
      await service.upsertMapping('lab1', {
        analyzerId: 'an1',
        parameterCode: 'HGB',
        analyzerUnit: 'g/dL',
        catalogItemCode: 'CBC',
        analyteCode: 'HGB',
      });
      expect(prisma.analyzer.findFirst.mock.calls[0][0].where).toEqual({
        id: 'an1',
        labTenantId: 'lab1',
      });
      expect(
        prisma.instrumentParameterMapping.upsert.mock.calls[0][0].create
          .multiplier
      ).toBe(1);
      prisma.analyzer.findFirst.mockResolvedValue(null);
      await expect(
        service.upsertMapping('lab1', {
          analyzerId: 'x',
          parameterCode: 'a',
          analyzerUnit: 'b',
          catalogItemCode: 'c',
          analyteCode: 'd',
        })
      ).rejects.toThrow(NotFoundException);
    });
    it('delete is scoped to the lab', async () => {
      prisma.instrumentParameterMapping.findFirst.mockResolvedValue(null);
      await expect(service.deleteMapping('lab2', 'mp1')).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
