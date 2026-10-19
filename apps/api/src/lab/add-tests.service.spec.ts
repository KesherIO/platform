import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddTestsService } from './add-tests.service';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { NotificationService } from '../notifications/notification.service';
import { OrderStatusService } from './order-status.service';
import { clinicOrderRecipients } from '../notifications/clinic-recipients';
import { lockOrderReport } from './report-lock.util';

jest.mock('../notifications/clinic-recipients', () => ({
  clinicOrderRecipients: jest.fn(),
}));
jest.mock('./report-lock.util', () => ({ lockOrderReport: jest.fn() }));

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
const plasma = { specimenType: 'HEPARIN_PLASMA', containerType: 'LH_TUBE' };

type Req = { specimenType: string; containerType: string };
/** One requirement group per argument; a group's first entry is the
 * primary, the rest are alternatives within it */
const config = (...groups: Req[][]) => ({
  department: 'HEMATOLOGY',
  defaultProcessingMethod: 'MANUAL',
  defaultAnalyzerId: null,
  specimenRequirements: groups.flatMap((group, g) =>
    group.map((req, i) => ({
      ...req,
      requirementGroupKey: `g${g}`,
      isAlternativeWithinGroup: i > 0,
      sortOrder: g * 10 + i,
    }))
  ),
});

const NO_FLAGS = {
  isHemolyzed: false,
  isLipemic: false,
  isIcteric: false,
  isInsufficient: false,
  isContaminated: false,
  isWrongContainer: false,
  isLeaking: false,
};
const tube = (
  id: string,
  status: string,
  kind: Req,
  flags: Partial<typeof NO_FLAGS> = {}
) => ({
  id,
  accessionNumber: `REQ-1-${id}`,
  status,
  ...kind,
  ...NO_FLAGS,
  ...flags,
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
    specimens: [tube('sp-edta', 'ACCEPTED', edta)],
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
      orderedTestSpecimen: { createMany: jest.fn() },
      specimen: { create: jest.fn() },
      pickup: { create: jest.fn() },
      timelineEvent: {
        create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
        createMany: jest.fn(),
      },
    };
    db.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(db));
    db.$queryRaw = jest.fn().mockResolvedValue([]);
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

    it('is READY on an accepted tube of the kind, listed for confirmation', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config([edta]) });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests).toEqual([
        expect.objectContaining({ catalogItemId: 'cbc', outcome: 'READY' }),
      ]);
      expect(p.canAdd).toBe(true);
      expect(p.specimens).toEqual([
        {
          id: 'sp-edta',
          accessionNumber: 'REQ-1-sp-edta',
          ...edta,
          conditions: [],
          testNames: ['CBC'],
        },
      ]);
    });

    it('lists one tube once for every test running on it, with its conditions', async () => {
      db.order.findFirst.mockResolvedValue(
        order({
          specimens: [
            tube('sp-serum', 'ACCEPTED', serum, { isHemolyzed: true }),
          ],
        })
      );
      catalog([CHEM, { ...CHEM, id: 'chem2', code: 'C2', name: 'Chem 2' }], {
        chem: config([serum]),
        chem2: config([serum]),
      });

      const p = await service.preview('o-1', 'lab-1', ['chem', 'chem2']);

      expect(p.specimens).toEqual([
        expect.objectContaining({
          id: 'sp-serum',
          conditions: ['isHemolyzed'],
          testNames: ['Chemistry', 'Chem 2'],
        }),
      ]);
    });

    it('accepts an alternative within the requirement group', async () => {
      db.order.findFirst.mockResolvedValue(
        order({ specimens: [tube('sp-plasma', 'ACCEPTED', plasma)] })
      );
      catalog([CHEM], { chem: config([serum, plasma]) });

      const p = await service.preview('o-1', 'lab-1', ['chem']);

      expect(p.tests[0].outcome).toBe('READY');
      expect(p.specimens.map((sp) => sp.id)).toEqual(['sp-plasma']);
    });

    it('needs an accepted tube for every requirement group', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CHEM], { chem: config([edta], [serum]) });

      const p = await service.preview('o-1', 'lab-1', ['chem']);

      expect(p.tests[0].outcome).toBe('NO_SPECIMEN');
      expect(p.canAdd).toBe(false);
    });

    it('is NO_SPECIMEN when no compatible tube is at the lab', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CHEM], { chem: config([serum]) });

      const p = await service.preview('o-1', 'lab-1', ['chem']);

      expect(p.tests[0].outcome).toBe('NO_SPECIMEN');
      expect(p.canAdd).toBe(false);
      expect(p.specimens).toEqual([]);
    });

    it.each(['EXPECTED', 'RECEIVED'])(
      'is AWAITING_SPECIMEN when the compatible tube is only %s',
      async (status) => {
        db.order.findFirst.mockResolvedValue(
          order({ specimens: [tube('sp-wait', status, serum)] })
        );
        catalog([CHEM], { chem: config([serum]) });

        const p = await service.preview('o-1', 'lab-1', ['chem']);

        expect(p.tests[0].outcome).toBe('AWAITING_SPECIMEN');
        expect(p.canAdd).toBe(false);
      }
    );

    it('is NO_REQUIREMENT when no specimen requirement is configured', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: null });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests[0].outcome).toBe('NO_REQUIREMENT');
      expect(p.canAdd).toBe(false);
    });

    it('cannot add when any selected test is blocked, and lists no tubes to confirm', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC, CHEM], { cbc: config([edta]), chem: config([serum]) });

      const p = await service.preview('o-1', 'lab-1', ['cbc', 'chem']);

      expect(p.tests.map((t) => t.outcome)).toEqual(['READY', 'NO_SPECIMEN']);
      expect(p.canAdd).toBe(false);
      expect(p.specimens).toEqual([]);
    });

    it('is NO_TEMPLATE (still addable) when the sample is there but no template is published', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config([edta]) });
      templates.resolveTemplateForTest.mockResolvedValue(null);

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests[0].outcome).toBe('NO_TEMPLATE');
      expect(p.canAdd).toBe(true);
    });

    it('lists tests already on the order and leaves them out', async () => {
      db.order.findFirst.mockResolvedValue(
        order({ orderedTests: [{ catalogItemId: 'cbc' }] })
      );
      catalog([CBC], { cbc: config([edta]) });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests).toEqual([]);
      expect(p.canAdd).toBe(false);
      expect(p.alreadyOnOrder).toEqual([{ catalogItemId: 'cbc', name: 'CBC' }]);
    });
  });

  describe('addTests', () => {
    const actor = ['o-1', 'lab-1'] as const;

    function arrange(over: Record<string, unknown> = {}) {
      db.order.findFirst
        .mockResolvedValueOnce({
          id: 'o-1',
          caseId: 'case-1',
          tenantId: 'clinic-1',
        })
        .mockResolvedValueOnce(order(over));
    }

    function expectNothingWritten() {
      expect(db.orderedTest.create).not.toHaveBeenCalled();
      expect(db.orderedTestSpecimen.createMany).not.toHaveBeenCalled();
      expect(db.order.update).not.toHaveBeenCalled();
      expect(db.timelineEvent.create).not.toHaveBeenCalled();
      expect(notifications.publish).not.toHaveBeenCalled();
    }

    it('locks the report and the tubes, links the test to the confirmed tube and notifies vets', async () => {
      arrange();
      catalog([CBC], { cbc: config([edta]) });

      const result = await service.addTests(
        ...actor,
        {
          catalogItemIds: ['cbc'],
          confirmedSpecimenIds: ['sp-edta'],
          note: 'vet asked',
        },
        'u-1',
        'Ana Lab'
      );

      expect(lockOrderReport).toHaveBeenCalledWith(db, {
        id: 'o-1',
        caseId: 'case-1',
        tenantId: 'clinic-1',
      });
      // Tubes are locked before the plan reads them
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain(
        'FROM specimens WHERE "orderId" = ? FOR UPDATE'
      );
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.order.findFirst.mock.invocationCallOrder[1]
      );
      expect(db.orderedTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'o-1',
            catalogItemId: 'cbc',
            status: 'READY',
            receivedAt: expect.any(Date),
          }),
        })
      );
      expect(db.orderedTestSpecimen.createMany).toHaveBeenCalledWith({
        data: [{ orderedTestId: expect.any(String), specimenId: 'sp-edta' }],
      });
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
            confirmedSpecimens: [
              {
                id: 'sp-edta',
                accessionNumber: 'REQ-1-sp-edta',
                testNames: ['CBC'],
              },
            ],
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
          },
        })
      );
      expect(notifications.deliverQueued).toHaveBeenCalled();
      expect(result.order).toEqual({ id: 'o-1', status: 'PROCESSING' });
    });

    it('never creates a tube or a pickup', async () => {
      arrange({ specimens: [tube('sp-serum', 'ACCEPTED', serum)] });
      catalog([CHEM, { ...CHEM, id: 'chem2', code: 'C2', name: 'Chem 2' }], {
        chem: config([serum]),
        chem2: config([serum]),
      });

      await service.addTests(
        ...actor,
        {
          catalogItemIds: ['chem', 'chem2'],
          confirmedSpecimenIds: ['sp-serum'],
        },
        'u-1',
        'A'
      );

      expect(db.orderedTest.create).toHaveBeenCalledTimes(2);
      for (const call of db.orderedTest.create.mock.calls) {
        expect(call[0].data.status).toBe('READY');
      }
      expect(db.specimen.create).not.toHaveBeenCalled();
      expect(db.pickup.create).not.toHaveBeenCalled();
    });

    it('links a test to one tube per requirement group', async () => {
      arrange({
        specimens: [
          tube('sp-edta', 'ACCEPTED', edta),
          tube('sp-serum', 'ACCEPTED', serum),
        ],
      });
      catalog([CHEM], { chem: config([edta], [serum]) });

      await service.addTests(
        ...actor,
        {
          catalogItemIds: ['chem'],
          confirmedSpecimenIds: ['sp-edta', 'sp-serum'],
        },
        'u-1',
        'A'
      );

      expect(db.orderedTestSpecimen.createMany).toHaveBeenCalledWith({
        data: [
          { orderedTestId: expect.any(String), specimenId: 'sp-edta' },
          { orderedTestId: expect.any(String), specimenId: 'sp-serum' },
        ],
      });
    });

    it.each([
      ['no compatible tube is at the lab', {}, config([serum])],
      [
        'the compatible tube is only expected',
        { specimens: [tube('sp-wait', 'EXPECTED', serum)] },
        config([serum]),
      ],
      [
        'the compatible tube is received but not accepted',
        { specimens: [tube('sp-recv', 'RECEIVED', serum)] },
        config([serum]),
      ],
      ['no specimen requirement is configured', {}, null],
    ])('refuses when %s, writing nothing', async (_case, over, chemConfig) => {
      arrange(over);
      catalog([CHEM], { chem: chemConfig });

      await expect(
        service.addTests(
          ...actor,
          { catalogItemIds: ['chem'], confirmedSpecimenIds: [] },
          'u-1',
          'A'
        )
      ).rejects.toThrow(/already accepted at the lab: Chemistry/);
      expectNothingWritten();
      expect(db.specimen.create).not.toHaveBeenCalled();
    });

    it('refuses the whole selection when one test cannot be added', async () => {
      arrange();
      catalog([CBC, CHEM], { cbc: config([edta]), chem: config([serum]) });

      await expect(
        service.addTests(
          ...actor,
          {
            catalogItemIds: ['cbc', 'chem'],
            confirmedSpecimenIds: ['sp-edta'],
          },
          'u-1',
          'A'
        )
      ).rejects.toThrow(BadRequestException);
      expectNothingWritten();
    });

    it('refuses until every tube used is confirmed to have enough usable sample', async () => {
      arrange({
        specimens: [
          tube('sp-edta', 'ACCEPTED', edta),
          tube('sp-serum', 'ACCEPTED', serum),
        ],
      });
      catalog([CBC, CHEM], { cbc: config([edta]), chem: config([serum]) });

      await expect(
        service.addTests(
          ...actor,
          {
            catalogItemIds: ['cbc', 'chem'],
            confirmedSpecimenIds: ['sp-edta'],
          },
          'u-1',
          'A'
        )
      ).rejects.toThrow(/enough usable sample in REQ-1-sp-serum/);
      expectNothingWritten();
    });

    it('refuses when the confirmed tube was rejected since the preview', async () => {
      // The plan re-reads the tubes under the lock, and only reads ones
      // ACCEPTED, RECEIVED or EXPECTED: the rejected tube isn't there
      arrange({ specimens: [] });
      catalog([CBC], { cbc: config([edta]) });

      await expect(
        service.addTests(
          ...actor,
          { catalogItemIds: ['cbc'], confirmedSpecimenIds: ['sp-edta'] },
          'u-1',
          'A'
        )
      ).rejects.toThrow(/already accepted at the lab: CBC/);
      expectNothingWritten();
    });

    it('adds a test with no published template as blocked, and records why', async () => {
      arrange();
      catalog([CBC], { cbc: config([edta]) });
      templates.resolveTemplateForTest.mockResolvedValue(null);

      await service.addTests(
        ...actor,
        { catalogItemIds: ['cbc'], confirmedSpecimenIds: ['sp-edta'] },
        'u-1',
        'A'
      );

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
      arrange({ orderedTests: [{ catalogItemId: 'cbc' }] });
      catalog([CBC], { cbc: config([edta]) });

      await expect(
        service.addTests(
          ...actor,
          { catalogItemIds: ['cbc'], confirmedSpecimenIds: [] },
          'u-1',
          'A'
        )
      ).rejects.toThrow(BadRequestException);
      expectNothingWritten();
    });

    it('404s for an order of another lab before locking anything', async () => {
      db.order.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.addTests(
          ...actor,
          { catalogItemIds: ['cbc'], confirmedSpecimenIds: [] },
          'u-1',
          'A'
        )
      ).rejects.toThrow(NotFoundException);
      expect(lockOrderReport).not.toHaveBeenCalled();
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
