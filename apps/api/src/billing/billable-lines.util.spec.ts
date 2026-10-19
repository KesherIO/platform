import type { OrderedItem } from '@vet-ai/shared-types';
import {
  deriveBillableLines,
  type BillableOrderInput,
} from './billable-lines.util';

const item = (
  catalogItemId: string,
  kind: 'TEST' | 'PACKAGE',
  code: string
): OrderedItem => ({
  catalogItemId,
  code,
  name: `${code} name`,
  kind,
  category: null,
  turnaroundHours: null,
});

const order = (over: Partial<BillableOrderInput>): BillableOrderInput => ({
  id: 'o1',
  requisitionNumber: 'REQ-1',
  status: 'PENDING',
  createdAt: new Date('2026-10-18T15:00:00Z'),
  clinicName: 'Clínica Ñandú',
  patientName: 'Max',
  orderedItems: [],
  orderedTests: [],
  ...over,
});

const keys = (r: ReturnType<typeof deriveBillableLines>) =>
  r.lines.map((l) => l.lineKey);

describe('deriveBillableLines', () => {
  it('bills a pending order that has no tests yet (not accessioned)', () => {
    const r = deriveBillableLines([
      order({ orderedItems: [item('t1', 'TEST', 'ALT')] }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      catalogItemId: 't1',
      quantity: 1,
      clinicName: 'Clínica Ñandú',
      patientName: 'Max',
    });
  });

  it('bills completed orders too', () => {
    const r = deriveBillableLines([
      order({
        status: 'COMPLETED',
        orderedItems: [item('t1', 'TEST', 'ALT')],
        orderedTests: [
          {
            catalogItemId: 't1',
            status: 'COMPLETED',
            sources: [{ originalOrderItemKey: 'line-0' }],
          },
        ],
      }),
    ]);
    expect(keys(r)).toEqual(['line-0']);
  });

  it('charges a package once, never its component tests', () => {
    const r = deriveBillableLines([
      order({
        orderedItems: [item('pkg', 'PACKAGE', 'PREN')],
        orderedTests: ['c1', 'c2', 'c3'].map((id) => ({
          catalogItemId: id,
          status: 'READY',
          sources: [{ originalOrderItemKey: 'line-0' }],
        })),
      }),
    ]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ catalogItemId: 'pkg', kind: 'PACKAGE' });
  });

  it('charges a later-added test as its own line next to the package', () => {
    const r = deriveBillableLines([
      order({
        orderedItems: [
          item('pkg', 'PACKAGE', 'PREN'),
          item('extra', 'TEST', 'SDMA'),
        ],
        orderedTests: [
          {
            catalogItemId: 'c1',
            status: 'READY',
            sources: [{ originalOrderItemKey: 'line-0' }],
          },
          {
            catalogItemId: 'extra',
            status: 'PENDING',
            sources: [{ originalOrderItemKey: 'line-1' }],
          },
        ],
      }),
    ]);
    expect(r.lines.map((l) => [l.lineKey, l.catalogItemId])).toEqual([
      ['line-0', 'pkg'],
      ['line-1', 'extra'],
    ]);
  });

  it('excludes every line of a cancelled order, even without tests', () => {
    const r = deriveBillableLines([
      order({
        status: 'CANCELLED',
        orderedItems: [item('t1', 'TEST', 'A'), item('t2', 'TEST', 'B')],
      }),
    ]);
    expect(r.lines).toEqual([]);
    expect(r.excluded.map((e) => e.reason)).toEqual([
      'ORDER_CANCELLED',
      'ORDER_CANCELLED',
    ]);
  });

  it('excludes a cancelled standalone test but keeps the rest', () => {
    const r = deriveBillableLines([
      order({
        orderedItems: [item('t1', 'TEST', 'A'), item('t2', 'TEST', 'B')],
        orderedTests: [
          {
            catalogItemId: 't1',
            status: 'CANCELLED',
            sources: [{ originalOrderItemKey: 'line-0' }],
          },
          {
            catalogItemId: 't2',
            status: 'PENDING',
            sources: [{ originalOrderItemKey: 'line-1' }],
          },
        ],
      }),
    ]);
    expect(keys(r)).toEqual(['line-1']);
    expect(r.excluded).toEqual([
      { orderId: 'o1', lineKey: 'line-0', reason: 'ITEM_CANCELLED' },
    ]);
  });

  it('excludes a package only when ALL its components are cancelled', () => {
    const tests = (statuses: string[]) =>
      statuses.map((status, i) => ({
        catalogItemId: `c${i}`,
        status,
        sources: [{ originalOrderItemKey: 'line-0' }],
      }));
    const partial = deriveBillableLines([
      order({
        orderedItems: [item('pkg', 'PACKAGE', 'P')],
        orderedTests: tests(['CANCELLED', 'READY']),
      }),
    ]);
    const all = deriveBillableLines([
      order({
        orderedItems: [item('pkg', 'PACKAGE', 'P')],
        orderedTests: tests(['CANCELLED', 'CANCELLED']),
      }),
    ]);
    expect(keys(partial)).toEqual(['line-0']);
    expect(keys(all)).toEqual([]);
  });

  it('a test shared by a package and a direct line cancels both lines', () => {
    const r = deriveBillableLines([
      order({
        orderedItems: [item('pkg', 'PACKAGE', 'P'), item('cbc', 'TEST', 'CBC')],
        orderedTests: [
          {
            catalogItemId: 'cbc',
            status: 'CANCELLED',
            sources: [
              { originalOrderItemKey: 'line-0' },
              { originalOrderItemKey: 'line-1' },
            ],
          },
        ],
      }),
    ]);
    expect(keys(r)).toEqual([]);
  });

  it('amendments, re-releases and replaced specimens leave the lines as they were', () => {
    // None of them touch orderedItems or OrderedTest rows other than their
    // status/version, so the same input always yields the same single charge.
    const base = order({
      status: 'COMPLETED',
      orderedItems: [item('t1', 'TEST', 'ALT')],
      orderedTests: [
        {
          catalogItemId: 't1',
          status: 'COMPLETED',
          sources: [{ originalOrderItemKey: 'line-0' }],
        },
      ],
    });
    const amended = {
      ...base,
      orderedTests: [{ ...base.orderedTests[0], status: 'IN_REVIEW' }],
    };
    expect(deriveBillableLines([base]).lines).toHaveLength(1);
    expect(deriveBillableLines([amended]).lines).toHaveLength(1);
  });

  it('matches legacy orders (tests without sources) by catalog item', () => {
    const r = deriveBillableLines([
      order({
        orderedItems: [item('t1', 'TEST', 'A'), item('t2', 'TEST', 'B')],
        orderedTests: [
          { catalogItemId: 't1', status: 'CANCELLED', sources: [] },
          { catalogItemId: 't2', status: 'READY', sources: [] },
        ],
      }),
    ]);
    expect(keys(r)).toEqual(['line-1']);
  });

  it('keeps one line per ordered line, one order per row set', () => {
    const r = deriveBillableLines([
      order({ id: 'a', orderedItems: [item('t1', 'TEST', 'A')] }),
      order({ id: 'b', orderedItems: [item('t1', 'TEST', 'A')] }),
    ]);
    expect(r.lines.map((l) => l.orderId)).toEqual(['a', 'b']);
  });
});
