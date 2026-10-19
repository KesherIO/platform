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

/** Specimen requirements are optional: none is read when adding tests */
const config = () => ({
  department: 'HEMATOLOGY',
  defaultProcessingMethod: 'MANUAL',
  defaultAnalyzerId: null,
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
type Kind = { specimenType: string; containerType: string };
/** An ACCEPTED sample, as the plan reads it */
const tube = (
  id: string,
  kind: Kind,
  flags: Partial<typeof NO_FLAGS> = {}
) => ({
  id,
  accessionNumber: `REQ-1-${id}`,
  ...kind,
  ...NO_FLAGS,
  ...flags,
});
const picked = (id: string, kind: Kind, conditions: string[] = []) => ({
  id,
  accessionNumber: `REQ-1-${id}`,
  ...kind,
  conditions,
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

  /** `specimens` are the ACCEPTED ones the plan reads; `specimenRecords`
   * is how many the order has in any status (defaults to the accepted) */
  const order = ({
    specimenRecords,
    ...over
  }: Record<string, unknown> & { specimenRecords?: number } = {}) => {
    const base = {
      id: 'o-1',
      status: 'RECEIVED_BY_LAB',
      caseId: 'case-1',
      tenantId: 'clinic-1',
      requisitionNumber: 'REQ-1',
      orderedItems: [{ catalogItemId: 'old', name: 'Old' }],
      case: { patientSpecies: 'DOG', patientAge: 3, patientAgeUnit: 'YEARS' },
      orderedTests: [{ catalogItemId: 'old' }],
      specimens: [tube('sp-edta', edta)],
      ...over,
    };
    return {
      ...base,
      _count: { specimens: specimenRecords ?? base.specimens.length },
    };
  };

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

    it('reads only ACCEPTED samples of the order', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config() });

      await service.preview('o-1', 'lab-1', ['cbc']);

      expect(db.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            specimens: expect.objectContaining({
              where: { status: 'ACCEPTED' },
            }),
          }),
        })
      );
    });

    it('offers the accepted samples, with conditions recorded at receipt', async () => {
      db.order.findFirst.mockResolvedValue(
        order({
          specimens: [
            tube('sp-edta', edta),
            tube('sp-serum', serum, { isHemolyzed: true }),
          ],
        })
      );
      catalog([CBC], { cbc: config() });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests).toEqual([
        expect.objectContaining({ catalogItemId: 'cbc', outcome: 'READY' }),
      ]);
      expect(p.canAdd).toBe(true);
      expect(p.sampleMode).toBe('SELECT_ACCEPTED');
      expect(p.acceptedSpecimens).toEqual([
        picked('sp-edta', edta),
        picked('sp-serum', serum, ['isHemolyzed']),
      ]);
    });

    it('counts specimen records in any status', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config() });

      await service.preview('o-1', 'lab-1', ['cbc']);

      expect(db.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            _count: { select: { specimens: true } },
          }),
        })
      );
    });

    it.each(['RECEIVED_BY_LAB', 'PROCESSING'])(
      'lets staff confirm the received sample of a %s order with no specimen records',
      async (status) => {
        db.order.findFirst.mockResolvedValue(order({ status, specimens: [] }));
        catalog([CBC], { cbc: config() });

        const p = await service.preview('o-1', 'lab-1', ['cbc']);

        expect(p.sampleMode).toBe('CONFIRM_RECEIVED_ORDER');
        expect(p.acceptedSpecimens).toEqual([]);
        expect(p.canAdd).toBe(true);
      }
    );

    it.each(['PENDING', 'READY_FOR_PICKUP', 'COLLECTED'])(
      'cannot add to a %s order with no specimen records',
      async (status) => {
        db.order.findFirst.mockResolvedValue(order({ status, specimens: [] }));
        catalog([CBC], { cbc: config() });

        const p = await service.preview('o-1', 'lab-1', ['cbc']);

        expect(p.sampleMode).toBe('NOT_RECEIVED');
        expect(p.canAdd).toBe(false);
      }
    );

    it('does not fall back to confirming the order when its records are all pending or rejected', async () => {
      db.order.findFirst.mockResolvedValue(
        order({ specimens: [], specimenRecords: 2 })
      );
      catalog([CBC], { cbc: config() });

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.sampleMode).toBe('NO_ACCEPTED_SPECIMEN');
      expect(p.acceptedSpecimens).toEqual([]);
      expect(p.canAdd).toBe(false);
    });

    it.each([
      ['no specimen requirement is configured', { cbc: config() }],
      ['no lab configuration exists at all', { cbc: null }],
    ])('can add when %s', async (_case, configs) => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], configs);

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests[0].outcome).toBe('READY');
      expect(p.canAdd).toBe(true);
    });

    it('is NO_TEMPLATE (still addable) when no template is published', async () => {
      db.order.findFirst.mockResolvedValue(order());
      catalog([CBC], { cbc: config() });
      templates.resolveTemplateForTest.mockResolvedValue(null);

      const p = await service.preview('o-1', 'lab-1', ['cbc']);

      expect(p.tests[0].outcome).toBe('NO_TEMPLATE');
      expect(p.canAdd).toBe(true);
    });

    it('lists tests already on the order and leaves them out', async () => {
      db.order.findFirst.mockResolvedValue(
        order({ orderedTests: [{ catalogItemId: 'cbc' }] })
      );
      catalog([CBC], { cbc: config() });

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

    const body = (over: Record<string, unknown> = {}) => ({
      catalogItemIds: ['cbc'],
      specimenIds: ['sp-edta'],
      confirmedSuitable: true as const,
      ...over,
    });

    function expectNothingWritten() {
      expect(db.orderedTest.create).not.toHaveBeenCalled();
      expect(db.orderedTestSpecimen.createMany).not.toHaveBeenCalled();
      expect(db.order.update).not.toHaveBeenCalled();
      expect(db.timelineEvent.create).not.toHaveBeenCalled();
      expect(notifications.publish).not.toHaveBeenCalled();
    }

    it('locks the report and the samples, links the test to the picked sample and notifies vets', async () => {
      arrange();
      catalog([CBC], { cbc: config() });

      const result = await service.addTests(
        ...actor,
        body({ note: 'vet asked' }),
        'u-1',
        'Ana Lab'
      );

      expect(lockOrderReport).toHaveBeenCalledWith(db, {
        id: 'o-1',
        caseId: 'case-1',
        tenantId: 'clinic-1',
      });
      // The order row and its samples are locked before the plan reads them
      expect(db.$queryRaw).toHaveBeenCalledTimes(2);
      expect(db.$queryRaw.mock.calls[0][0].join('?')).toContain(
        'FROM orders WHERE id = ? FOR UPDATE'
      );
      expect(db.$queryRaw.mock.calls[1][0].join('?')).toContain(
        'FROM specimens WHERE "orderId" = ? FOR UPDATE'
      );
      expect(db.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
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
      expect(result.specimens).toEqual([picked('sp-edta', edta)]);
      expect(result.order).toEqual({ id: 'o-1', status: 'PROCESSING' });
    });

    it('records the picked samples and who confirmed them on the timeline', async () => {
      arrange({
        specimens: [tube('sp-edta', edta, { isLipemic: true })],
      });
      catalog([CBC], { cbc: config() });

      await service.addTests(
        ...actor,
        body({ note: 'vet asked' }),
        'u-1',
        'Ana Lab'
      );

      expect(db.timelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'TESTS_ADDED',
          actorId: 'u-1',
          actorName: 'Ana Lab',
          metadata: expect.objectContaining({
            testNames: ['CBC'],
            selectedSpecimens: [picked('sp-edta', edta, ['isLipemic'])],
            sampleConfirmation: {
              basis: 'SELECT_ACCEPTED',
              suitableAndSufficient: true,
              confirmedById: 'u-1',
              confirmedByName: 'Ana Lab',
              confirmedAt: expect.any(String),
            },
            note: 'vet asked',
          }),
        }),
        select: { id: true },
      });
    });

    it('links every added test to every picked sample, whatever their requirements', async () => {
      arrange({
        specimens: [tube('sp-edta', edta), tube('sp-serum', serum)],
      });
      catalog([CBC, CHEM], { cbc: null, chem: config() });

      await service.addTests(
        ...actor,
        body({
          catalogItemIds: ['cbc', 'chem'],
          specimenIds: ['sp-edta', 'sp-serum'],
        }),
        'u-1',
        'A'
      );

      expect(db.orderedTest.create).toHaveBeenCalledTimes(2);
      expect(db.orderedTestSpecimen.createMany).toHaveBeenCalledTimes(2);
      for (const call of db.orderedTestSpecimen.createMany.mock.calls) {
        expect(
          call[0].data.map((l: { specimenId: string }) => l.specimenId)
        ).toEqual(['sp-edta', 'sp-serum']);
      }
    });

    it('never creates a sample or a pickup', async () => {
      arrange();
      catalog([CBC], { cbc: config() });

      await service.addTests(...actor, body(), 'u-1', 'A');

      expect(db.specimen.create).not.toHaveBeenCalled();
      expect(db.pickup.create).not.toHaveBeenCalled();
    });

    it('refuses without the suitability confirmation, writing nothing', async () => {
      arrange();
      catalog([CBC], { cbc: config() });

      await expect(
        service.addTests(
          ...actor,
          body({ confirmedSuitable: false }),
          'u-1',
          'A'
        )
      ).rejects.toThrow(/suitable and sufficient/);
      expectNothingWritten();
    });

    it.each([
      ['another order’s or an unknown sample', ['sp-other']],
      ['one accepted and one not', ['sp-edta', 'sp-other']],
    ])('refuses %s, writing nothing', async (_case, specimenIds) => {
      arrange();
      catalog([CBC], { cbc: config() });

      await expect(
        service.addTests(...actor, body({ specimenIds }), 'u-1', 'A')
      ).rejects.toThrow(/already accepted at the lab/);
      expectNothingWritten();
    });

    it.each([
      ['empty', []],
      ['omitted', undefined],
    ])(
      'refuses samples %s when the order has accepted ones to pick',
      async (_case, specimenIds) => {
        arrange();
        catalog([CBC], { cbc: config() });

        await expect(
          service.addTests(...actor, body({ specimenIds }), 'u-1', 'A')
        ).rejects.toThrow(/Select the accepted samples/);
        expectNothingWritten();
      }
    );

    it('refuses when the picked sample was rejected since the preview', async () => {
      // The plan re-reads ACCEPTED samples under the lock: it's gone, the
      // record remains (no fallback to confirming the order)
      arrange({ specimens: [], specimenRecords: 1 });
      catalog([CBC], { cbc: config() });

      await expect(
        service.addTests(...actor, body(), 'u-1', 'A')
      ).rejects.toThrow(/accept one first/);
      expectNothingWritten();
    });

    describe('a received order with no specimen records', () => {
      it('adds on the confirmed received sample, links nothing and records the basis', async () => {
        arrange({ specimens: [] });
        catalog([CBC], { cbc: null });

        const result = await service.addTests(
          ...actor,
          body({ specimenIds: [] }),
          'u-1',
          'Ana Lab'
        );

        expect(db.orderedTest.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              catalogItemId: 'cbc',
              status: 'READY',
            }),
          })
        );
        expect(db.orderedTestSpecimen.createMany).not.toHaveBeenCalled();
        expect(db.specimen.create).not.toHaveBeenCalled();
        expect(db.pickup.create).not.toHaveBeenCalled();
        expect(db.timelineEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            eventType: 'TESTS_ADDED',
            metadata: expect.objectContaining({
              selectedSpecimens: [],
              sampleConfirmation: {
                basis: 'CONFIRM_RECEIVED_ORDER',
                suitableAndSufficient: true,
                confirmedById: 'u-1',
                confirmedByName: 'Ana Lab',
                confirmedAt: expect.any(String),
              },
            }),
          }),
          select: { id: true },
        });
        expect(notifications.publish).toHaveBeenCalled();
        expect(result.specimens).toEqual([]);
      });

      it('also accepts the samples omitted', async () => {
        arrange({ specimens: [] });
        catalog([CBC], { cbc: config() });

        await service.addTests(
          ...actor,
          body({ specimenIds: undefined }),
          'u-1',
          'A'
        );

        expect(db.orderedTest.create).toHaveBeenCalled();
      });

      it('still requires the confirmation', async () => {
        arrange({ specimens: [] });
        catalog([CBC], { cbc: config() });

        await expect(
          service.addTests(
            ...actor,
            body({ specimenIds: [], confirmedSuitable: false }),
            'u-1',
            'A'
          )
        ).rejects.toThrow(/suitable and sufficient/);
        expectNothingWritten();
      });

      it('refuses sample ids: there are none to select', async () => {
        arrange({ specimens: [] });
        catalog([CBC], { cbc: config() });

        await expect(
          service.addTests(...actor, body(), 'u-1', 'A')
        ).rejects.toThrow(/no specimen records to select/);
        expectNothingWritten();
      });

      it('refuses when the order is not received yet', async () => {
        arrange({ status: 'PENDING', specimens: [] });
        catalog([CBC], { cbc: config() });

        await expect(
          service.addTests(...actor, body({ specimenIds: [] }), 'u-1', 'A')
        ).rejects.toThrow(/received at the lab/);
        expectNothingWritten();
      });
    });

    it('adds a test with no published template as blocked, and records why', async () => {
      arrange();
      catalog([CBC], { cbc: config() });
      templates.resolveTemplateForTest.mockResolvedValue(null);

      await service.addTests(...actor, body(), 'u-1', 'A');

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
      catalog([CBC], { cbc: config() });

      await expect(
        service.addTests(...actor, body(), 'u-1', 'A')
      ).rejects.toThrow(BadRequestException);
      expectNothingWritten();
    });

    it('404s for an order of another lab before locking anything', async () => {
      db.order.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.addTests(...actor, body(), 'u-1', 'A')
      ).rejects.toThrow(NotFoundException);
      expect(lockOrderReport).not.toHaveBeenCalled();
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
