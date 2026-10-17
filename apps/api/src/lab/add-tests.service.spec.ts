import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddTestsService } from './add-tests.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { NotificationService } from '../notifications/notification.service';
import { OrderStatusService } from './order-status.service';
import { clinicOrderRecipients } from '../notifications/clinic-recipients';
import { lockOrderReport } from './report-lock.util';
import { createRequestedTube } from './requested-tube.util';

jest.mock('../notifications/clinic-recipients', () => ({
  clinicOrderRecipients: jest.fn(),
}));
jest.mock('./report-lock.util', () => ({ lockOrderReport: jest.fn() }));
jest.mock('./requested-tube.util', () => ({ createRequestedTube: jest.fn() }));

const CBC = {
  id: 'cbc',
  kind: 'TEST',
  code: 'CBC',
  name: 'CBC',
  category: null,
  turnaroundHours: 4,
};
const CHEM = {
  id: 'chem',
  kind: 'TEST',
  code: 'CHEM',
  name: 'Chemistry',
  category: null,
  turnaroundHours: 4,
};

const edta = { specimenType: 'EDTA_BLOOD', containerType: 'EDTA_TUBE' };
const serum = { specimenType: 'SERUM', containerType: 'SST_TUBE' };

const config = (req?: { specimenType: string; containerType: string }) => ({
  department: 'HEMATOLOGY',
  defaultProcessingMethod: 'MANUAL',
  defaultAnalyzerId: null,
  specimenRequirements: req
    ? [{ ...req, isAlternativeWithinGroup: false, sortOrder: 0 }]
    : [],
});

describe('AddTestsService', () => {
  let service: AddTestsService;
  let db: Record<string, any>;
  let templates: { resolveTemplateForTest: jest.Mock };
  let orderStatus: { deriveAndPersist: jest.Mock };
  const notifications = {
    publish: jest.fn().mockResolvedValue(1),
    deliverQueued: jest.fn(),
  };

  const order = (over: Record<string, unknown> = {}) => ({
    id: 'o-1',
    status: 'RECEIVED_BY_LAB',
    caseId: 'case-1',
    tenantId: 'clinic-1',
    requisitionNumber: 'REQ-1',
    orderedItems: [{ catalogItemId: 'old', name: 'Old' }],
    case: { patientSpecies: 'DOG', patientAge: 3, patientAgeUnit: 'YEARS' },
    orderedTests: [{ catalogItemId: 'old' }],
    specimens: [{ id: 'sp-edta', status: 'ACCEPTED', ...edta }],
    ...over,
  });

  /** catalogItem.findMany is called twice: the lines, then their configs */
  function catalog(
    items: (typeof CBC)[],
    configs: Record<string, ReturnType<typeof config> | null>
  ) {
    db.catalogItem.findMany.mockResolvedValueOnce(items).mockResolvedValueOnce(
      items.map((i) => ({
        id: i.id,
        code: i.code,
        labTestConfigurations: configs[i.id] ? [configs[i.id]] : [],
      }))
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    db = {
      order: { findFirst: jest.fn(), update: jest.fn() },
      catalogItem: { findMany: jest.fn() },
      catalogItemComposition: { findMany: jest.fn().mockResolvedValue([]) },
      orderedTest: {
        create: jest
          .fn()
          .mockImplementation(async () => ({ id: `ot-${Math.random()}` })),
      },
      orderedTestSpecimen: { create: jest.fn() },
      timelineEvent: {
        create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
        createMany: jest.fn(),
      },
    };
    db.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(db));
    templates = {
      resolveTemplateForTest: jest
        .fn()
        .mockResolvedValue({ id: 'def-1', activeVersionId: 'ver-1' }),
    };
    orderStatus = {
      deriveAndPersist: jest
        .fn()
        .mockResolvedValue({ orderStatus: 'PROCESSING' }),
    };
    (clinicOrderRecipients as jest.Mock).mockResolvedValue({
      tenantId: 'clinic-1',
      userIds: ['vet-1'],
      requisitionNumber: 'REQ-1',
      caseId: 'case-1',
    });
    (createRequestedTube as jest.Mock).mockResolvedValue({
      id: 'sp-new',
      accessionNumber: 'REQ-1-2',
    });

    const module = await Test.createTestingModule({
      providers: [
        AddTestsService,
        { provide: PrismaService, useValue: db },
        { provide: TemplateVersionService, useValue: templates },
        { provide: NotificationService, useValue: notifications },
        { provide: OrderStatusService, useValue: orderStatus },
      ],
    }).compile();
    service = module.get(AddTestsService);
  });

  describe('preview', () => {
    it('404s for an order of another lab', async () => {
      db.order.findFirst.mockResolvedValue(null);
      await expect(service.preview('o-1', 'lab-1', ['cbc'])).rejects.toThrow(
        NotFoundException
      );
    });

    it.each(['COMPLETED', 'CANCELLED'])(
      'rejects a %s order',
      async (status) => {
        db.order.findFirst.mockResolvedValue(order({ status }));
        await expect(service.preview('o-1', 'lab-1', ['cbc'])).rejects.toThrow(
          BadRequestException
        );
      }
    );

    it('rejects items outside the lab catalog', async () => {
      db.order.findFirst.mockResolvedValue(order());
      db.catalogItem.findMany.mockResolvedValueOnce([]);
      await expect(service.preview('o-1', 'lab-1', ['nope'])).rejects.toThrow(
        BadRequestException
      );
    });

    it('is READY when an accepted tube of the kind is already on the order', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config(edta) });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests).toEqual([
        expect.objectContaining({ catalogItemId: 'cbc', outcome: 'READY' }),
      ]);
      expect(p.sampleRequired).toBe(false);
      expect(p.tubes).toEqual([]);
    });

    it('needs a new tube when no tube of the kind is at the lab, shared by tests needing it', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CHEM, { ...CHEM, id: 'chem2', code: 'C2', name: 'Chem 2' }], {
        chem: config(serum),
        chem2: config(serum),
      });

      const p = await service.preview('o-1', 'lab-1', ['chem', 'chem2']);

      expect(p.tests.map((t) => t.outcome)).toEqual([
        'NEEDS_NEW_TUBE',
        'NEEDS_NEW_TUBE',
      ]);
      expect(p.sampleRequired).toBe(true);
      expect(p.tubes).toEqual([
        { ...serum, existing: false, testNames: ['Chemistry', 'Chem 2'] },
      ]);
    });

    it('joins a tube already requested instead of asking for another', async () => {
      db.order.findFirst.mockResolvedValue(
        order({
          specimens: [{ id: 'sp-wait', status: 'EXPECTED', ...serum }],
        })
      );
      catalog([CHEM], { chem: config(serum) });

      const p = await service.preview('o-1', 'lab-1', ['chem']);

      expect(p.tests[0].outcome).toBe('AWAITING_TUBE');
      expect(p.sampleRequired).toBe(false);
      expect(p.tubes[0]).toMatchObject({ existing: true });
    });

    it('is NO_TEMPLATE when the sample is covered but no template is published', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config(edta) });
      templates.resolveTemplateForTest.mockResolvedValue(null);

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests[0].outcome).toBe('NO_TEMPLATE');
    });

    it('is READY with no tube when the test has no specimen requirement', async () => {
      db.order.findFirst.mockResolvedValue(order({ specimens: [] }));
      catalog([CBC], { cbc: config() });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests[0].outcome).toBe('READY');
      expect(p.sampleRequired).toBe(false);
    });

    it('lists tests already on the order and leaves them out', async () => {
      db.order.findFirst.mockResolvedValue(
        order({ orderedTests: [{ catalogItemId: 'cbc' }] })
      );
      catalog([CBC], { cbc: config(edta) });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests).toEqual([]);
      expect(p.alreadyOnOrder).toEqual([{ catalogItemId: 'cbc', name: 'CBC' }]);
    });
  });

  describe('addTests', () => {
    const actor = ['o-1', 'lab-1'] as const;

    it('locks the report, creates the test, appends the line and notifies without a new tube', async () => {
      db.order.findFirst
        .mockResolvedValueOnce({
          id: 'o-1',
          caseId: 'case-1',
          tenantId: 'clinic-1',
        })
        .mockResolvedValueOnce(order());
      catalog([CBC], { cbc: config(edta) });

      const result = await service.addTests(
        ...actor,
        { catalogItemIds: ['cbc'], note: 'vet asked' },
        'u-1',
        'Ana Lab'
      );

      expect(lockOrderReport).toHaveBeenCalledWith(db, {
        id: 'o-1',
        caseId: 'case-1',
        tenantId: 'clinic-1',
      });
      expect(db.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'o-1',
            catalogItemId: 'cbc',
            status: 'READY',
          }),
        })
      );
      expect(db.orderedTestSpecimen.create).toHaveBeenCalledWith({
        data: { orderedTestId: expect.any(String), specimenId: 'sp-edta' },
      });
      expect(createRequestedTube).not.toHaveBeenCalled();
      expect(db.order.update).toHaveBeenCalledWith({
        where: { id: 'o-1' },
        data: {
          orderedItems: [
            { catalogItemId: 'old', name: 'Old' },
            expect.objectContaining({ catalogItemId: 'cbc', kind: 'TEST' }),
          ],
        },
      });
      expect(db.timelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'TESTS_ADDED',
          actorId: 'u-1',
          metadata: expect.objectContaining({
            testNames: ['CBC'],
            sampleRequired: false,
            note: 'vet asked',
          }),
        }),
        select: { id: true },
      });
      expect(clinicOrderRecipients).toHaveBeenCalledWith(db, 'o-1', {
        includeAdmins: false,
      });
      expect(notifications.publish).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          type: 'TESTS_ADDED',
          eventKey: 'order:o-1:tests-added:ev-1',
          params: {
            requisitionNumber: 'REQ-1',
            caseId: 'case-1',
            testNames: ['CBC'],
            sampleRequired: false,
          },
        })
      );
      expect(notifications.deliverQueued).toHaveBeenCalled();
      expect(result.order).toEqual({ id: 'o-1', status: 'PROCESSING' });
      expect(result.sampleRequired).toBe(false);
    });

    it('requests one new tube for tests needing it, creates no pickup and tells Owner/Admin too', async () => {
      db.order.findFirst
        .mockResolvedValueOnce({
          id: 'o-1',
          caseId: 'case-1',
          tenantId: 'clinic-1',
        })
        .mockResolvedValueOnce(order());
      catalog([CHEM, { ...CHEM, id: 'chem2', code: 'C2', name: 'Chem 2' }], {
        chem: config(serum),
        chem2: config(serum),
      });

      const result = await service.addTests(
        ...actor,
        { catalogItemIds: ['chem', 'chem2'] },
        'u-1',
        'Ana Lab'
      );

      expect(createRequestedTube).toHaveBeenCalledTimes(1);
      expect(createRequestedTube).toHaveBeenCalledWith(
        db,
        'o-1',
        'lab-1',
        'REQ-1',
        'SERUM',
        'SST_TUBE'
      );
      expect(db.orderedTest.create).toHaveBeenCalledTimes(2);
      for (const call of db.orderedTest.create.mock.calls) {
        expect(call[0].data.status).toBe('PENDING');
      }
      expect(db.orderedTestSpecimen.create).toHaveBeenCalledTimes(2);
      expect(db.orderedTestSpecimen.create).toHaveBeenCalledWith({
        data: { orderedTestId: expect.any(String), specimenId: 'sp-new' },
      });
      expect(clinicOrderRecipients).toHaveBeenCalledWith(db, 'o-1', {
        includeAdmins: true,
      });
      expect(notifications.publish).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          params: expect.objectContaining({ sampleRequired: true }),
        })
      );
      expect(result.sampleRequired).toBe(true);
    });

    it('blocks a test with no published template and records why', async () => {
      db.order.findFirst
        .mockResolvedValueOnce({
          id: 'o-1',
          caseId: 'case-1',
          tenantId: 'clinic-1',
        })
        .mockResolvedValueOnce(order());
      catalog([CBC], { cbc: config(edta) });
      templates.resolveTemplateForTest.mockResolvedValue(null);

      await service.addTests(...actor, { catalogItemIds: ['cbc'] }, 'u-1', 'A');

      expect(db.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'BLOCKED',
            blockReason: 'MISSING_RESULT_TEMPLATE',
          }),
        })
      );
      expect(db.timelineEvent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ eventType: 'TEST_BLOCKED' })],
      });
    });

    it('refuses when every selected test is already on the order, writing nothing', async () => {
      db.order.findFirst
        .mockResolvedValueOnce({
          id: 'o-1',
          caseId: 'case-1',
          tenantId: 'clinic-1',
        })
        .mockResolvedValueOnce(
          order({ orderedTests: [{ catalogItemId: 'cbc' }] })
        );
      catalog([CBC], { cbc: config(edta) });

      await expect(
        service.addTests(...actor, { catalogItemIds: ['cbc'] }, 'u-1', 'A')
      ).rejects.toThrow(BadRequestException);
      expect(db.orderedTest.create).not.toHaveBeenCalled();
      expect(notifications.publish).not.toHaveBeenCalled();
    });

    it('404s for an order of another lab before locking anything', async () => {
      db.order.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.addTests(...actor, { catalogItemIds: ['cbc'] }, 'u-1', 'A')
      ).rejects.toThrow(NotFoundException);
      expect(lockOrderReport).not.toHaveBeenCalled();
    });
  });
});
