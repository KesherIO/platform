import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const auth = { canRelease: false, isAdmin: false };
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../../shared/components/ToastProvider', () => ({
  useToast: () => toast,
}));
vi.mock('../../shared/api/labApi', () => ({
  apiErrorMessage: (e: Error) => e.message,
  labApi: {
    instruments: {
      get: vi.fn(),
      resolveSample: vi.fn(),
      approve: vi.fn(),
      dismiss: vi.fn(),
      reprocess: vi.fn(),
      downloadRaw: vi.fn(),
    },
    orders: { list: vi.fn() },
  },
}));

import { labApi } from '../../shared/api/labApi';
import { InstrumentDetailPanel } from './InstrumentDetailPanel';
import type { InstrumentMessageDetail } from '../../types/lab.types';

const base: InstrumentMessageDetail = {
  id: 'm1',
  status: 'UNMATCHED',
  reasons: ['UNMATCHED'],
  isComplete: true,
  incompleteReason: null,
  sampleId: '168',
  controlId: '2577',
  observationTime: '2026-10-20T00:14:57.000Z',
  receivedAtConnector: '2026-10-20T00:15:00.000Z',
  createdAt: '2026-10-20T00:15:01.000Z',
  hasAnalyzerEdits: false,
  hasExpiredReagent: false,
  importedCount: 0,
  resolvedAt: null,
  orderId: null,
  analyzer: { id: 'an1', name: 'VH30' },
  order: null,
  sha256: 'x',
  byteLength: 100,
  remoteAddress: null,
  processingError: null,
  reviewNote: null,
  reviewedAt: null,
  importedAt: null,
  diff: null,
  previousMessageId: null,
  history: [],
  approvableReasons: [],
  mappingPreview: null,
  orderedTestId: null,
  parsed: {
    patient: { sampleId: '168', name: null, speciesText: 'dog', sex: 'O' },
    images: [],
    parameters: [
      {
        code: 'WBC',
        valueType: 'NM',
        value: '13.23',
        unit: '10^9/L',
        referenceRange: '6.00-17.00',
        abnormalFlag: '',
        userFlag: 'O',
      },
      {
        code: 'HGB',
        valueType: 'NM',
        value: '5.7',
        unit: 'g/dL',
        referenceRange: '11-19',
        abnormalFlag: 'L',
        userFlag: 'E',
      },
    ],
  },
};

function show(detail: Partial<InstrumentMessageDetail>) {
  vi.mocked(labApi.instruments.get).mockResolvedValue({ ...base, ...detail });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InstrumentDetailPanel id="m1" onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InstrumentDetailPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    auth.canRelease = false;
  });

  it('an interrupted transfer says it is not a result and offers no link, approve or reprocess — only acknowledge and raw download', async () => {
    show({
      status: 'INCOMPLETE',
      isComplete: false,
      incompleteReason: 'trailing-partial',
      reasons: ['INCOMPLETE_TRANSFER'],
      parsed: null,
    });
    expect(
      await screen.findByText('instruments.detail.incomplete_title')
    ).toBeTruthy();
    expect(screen.getByText('instruments.detail.acknowledge')).toBeTruthy();
    expect(screen.getByText('instruments.detail.download_raw')).toBeTruthy();
    expect(screen.queryByText('instruments.detail.reprocess')).toBeNull();
    expect(screen.queryByText('instruments.detail.link_and_import')).toBeNull();
    expect(screen.queryByText('instruments.detail.approve_import')).toBeNull();
    expect(
      screen.queryByPlaceholderText('instruments.detail.order_search')
    ).toBeNull();
  });

  it('shows the expired-reagent and edited-on-analyzer flags as separate badges, per value', async () => {
    show({
      status: 'NEEDS_REVIEW',
      reasons: ['EXPIRED_REAGENT'],
      hasExpiredReagent: true,
      hasAnalyzerEdits: true,
    });
    await screen.findAllByText('instruments.badge.expired_reagent');
    expect(
      screen.getAllByText('instruments.badge.expired_reagent').length
    ).toBeGreaterThanOrEqual(2); // header badge + the flagged WBC row
    expect(
      screen.getAllByText('instruments.badge.edited').length
    ).toBeGreaterThanOrEqual(2); // header badge + the HGB row
  });

  it('only a reviewer sees the approve action for an approvable reason; an analyst is told who can', async () => {
    show({
      status: 'NEEDS_REVIEW',
      reasons: ['EXPIRED_REAGENT'],
      hasExpiredReagent: true,
    });
    expect(
      await screen.findByText('instruments.detail.reviewer_only')
    ).toBeTruthy();
    expect(screen.queryByText('instruments.detail.approve_import')).toBeNull();
    cleanup();

    auth.canRelease = true;
    show({
      status: 'NEEDS_REVIEW',
      reasons: ['EXPIRED_REAGENT'],
      hasExpiredReagent: true,
    });
    const approve = await screen.findByText(
      'instruments.detail.approve_import'
    );
    expect((approve.closest('button') as HTMLButtonElement).disabled).toBe(
      true
    ); // must tick the reason first
    fireEvent.click(screen.getByRole('checkbox'));
    expect((approve.closest('button') as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('makes PARTIAL mapping visible: what imports, what is not mapped, and which unit is unmapped — even for a message that is not matched yet', async () => {
    show({
      mappingPreview: {
        numericParameters: 4,
        isPartial: true,
        importable: [
          {
            analyzerCode: 'WBC',
            analyzerUnit: '10^9/L',
            rawValue: '13.23',
            catalogItemCode: 'CBC',
            analyteCode: 'WBC',
            multiplier: 1,
            value: 13.23,
          },
        ],
        unitMismatches: [{ code: 'HGB', unit: 'g/L', mappedUnits: ['g/dL'] }],
        notMapped: ['Mid#', 'Gran#'],
        notImported: [
          { code: 'Mid#', reason: 'NO_MAPPING' },
          { code: 'Gran#', reason: 'NO_MAPPING' },
        ],
      },
    });
    expect(
      await screen.findByText('instruments.detail.mapping_partial')
    ).toBeTruthy();
    expect(screen.getByText('instruments.detail.mapping_summary')).toBeTruthy();
    expect(
      screen.getByText('instruments.detail.mapping_not_mapped')
    ).toBeTruthy();
    expect(screen.getByText('instruments.detail.mapping_unit')).toBeTruthy();
    expect(screen.getByText('instruments.detail.mapping_to')).toBeTruthy(); // WBC → WBC on its row
    expect(
      screen.getByText('instruments.detail.mapping_unit_row')
    ).toBeTruthy(); // HGB flagged on its row
  });

  it('explains fields the template computes, so a reviewer is not surprised by a different MCV than the printout', async () => {
    show({
      status: 'IMPORTED',
      reasons: [],
      resolvedAt: null,
      parsed: {
        ...base.parsed!,
        import: {
          plan: [],
          ignored: [],
          formulaComputed: [
            { analyteCode: 'MCV', analyzerCode: 'MCV', analyzerValue: 68.5 },
          ],
        },
      },
    });
    expect(
      await screen.findByText('instruments.detail.formula_title')
    ).toBeTruthy();
    expect(
      screen.getByText(/MCV \(instruments\.detail\.analyzer_said 68\.5\)/)
    ).toBeTruthy();
  });

  it('an imported result links straight to the screen that shows its values (the order page itself does not)', async () => {
    show({
      status: 'IMPORTED',
      reasons: [],
      orderedTestId: 'test9',
      order: {
        id: 'ord9',
        requisitionNumber: 'DEV-VH30-0F3A84',
        status: 'RECEIVED_BY_LAB',
      },
    });
    const link = (
      await screen.findByText(/instruments\.detail\.open_draft ·/)
    ).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/orders/ord9/tests/test9/results');
  });

  it('offers no "open draft" link for a result that was not imported', async () => {
    show({
      status: 'NEEDS_REVIEW',
      reasons: ['EXPIRED_REAGENT'],
      hasExpiredReagent: true,
      orderedTestId: 'test9',
      order: { id: 'ord9', requisitionNumber: 'X', status: 'RECEIVED_BY_LAB' },
    });
    await screen.findByText('instruments.detail.why');
    expect(screen.queryByText(/instruments\.detail\.open_draft/)).toBeNull();
  });

  it('shows no partial warning when everything maps', async () => {
    show({
      mappingPreview: {
        numericParameters: 1,
        isPartial: false,
        importable: [
          {
            analyzerCode: 'WBC',
            analyzerUnit: '10^9/L',
            rawValue: '13.23',
            catalogItemCode: 'CBC',
            analyteCode: 'WBC',
            multiplier: 1,
            value: 13.23,
          },
        ],
        unitMismatches: [],
        notMapped: [],
        notImported: [],
      },
    });
    await screen.findByText('instruments.detail.mapping_summary');
    expect(screen.queryByText('instruments.detail.mapping_partial')).toBeNull();
  });

  it('a reason that must be fixed offers reprocess, never approve — even for a reviewer', async () => {
    auth.canRelease = true;
    show({
      status: 'NEEDS_REVIEW',
      reasons: ['UNIT_MISMATCH:HGB:g/L', 'EXPIRED_REAGENT'],
    });
    expect(
      await screen.findByText('instruments.detail.fix_then_reprocess')
    ).toBeTruthy();
    expect(screen.queryByText('instruments.detail.approve_import')).toBeNull();
    expect(screen.getByText('instruments.detail.reprocess')).toBeTruthy();
  });

  it('an unmatched sample is linked by choosing an order explicitly', async () => {
    vi.mocked(labApi.orders.list).mockResolvedValue({
      data: [
        {
          id: 'o9',
          requisitionNumber: 'REQ-9',
          patientName: 'Test Patient',
          clinicName: 'Vet Co',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 6,
      totalPages: 1,
    } as never);
    vi.mocked(labApi.instruments.resolveSample).mockResolvedValue({
      id: 'm1',
      status: 'IMPORTED',
    });
    show({});
    fireEvent.change(
      await screen.findByPlaceholderText('instruments.detail.order_search'),
      { target: { value: 'REQ' } }
    );
    fireEvent.click(await screen.findByText('REQ-9', {}, { timeout: 2000 }));
    fireEvent.click(screen.getByText('instruments.detail.link_and_import'));
    await waitFor(() =>
      expect(labApi.instruments.resolveSample).toHaveBeenCalledWith('m1', 'o9')
    );
  });
});
