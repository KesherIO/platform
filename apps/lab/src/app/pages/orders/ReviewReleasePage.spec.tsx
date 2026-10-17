import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const auth: { canRelease: boolean } = { canRelease: true };
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../shared/components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../shared/components/ConfirmDialogProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../shared/api/labApi', () => ({
  labApi: {
    orders: { getById: vi.fn() },
    amendment: {
      listActive: vi.fn(),
      get: vi.fn(),
      initiate: vi.fn(),
      submitForReview: vi.fn(),
      approve: vi.fn(),
    },
    review: {
      getReviewerSigners: vi.fn().mockResolvedValue([]),
      getAnalystSigners: vi.fn().mockResolvedValue([]),
    },
    resultEntry: { batchGetSessions: vi.fn().mockResolvedValue([]) },
    release: { getHistory: vi.fn().mockResolvedValue({ releases: [] }) },
  },
}));

import { labApi } from '../../shared/api/labApi';
import type {
  ActiveAmendmentSummary,
  LabOrderDetail,
} from '../../types/lab.types';
import { ReviewReleasePage } from './ReviewReleasePage';

const getById = vi.mocked(labApi.orders.getById);
const listActive = vi.mocked(labApi.amendment.listActive);
const getAmendment = vi.mocked(labApi.amendment.get);
const initiate = vi.mocked(labApi.amendment.initiate);
const submitForReview = vi.mocked(labApi.amendment.submitForReview);
const approve = vi.mocked(labApi.amendment.approve);
const getReviewerSigners = vi.mocked(labApi.review.getReviewerSigners);

/** Urinalysis released (COMPLETED), with an amendment of it. */
const order = {
  id: 'order-1',
  requisitionNumber: 'REQ-3',
  status: 'COMPLETED',
  case: { patientName: 'Phoebe', patientSpecies: 'CAT', ownerName: 'Pepe' },
  orderedTests: [
    { id: 'ot-1', status: 'COMPLETED', catalogItemName: 'Urianálisis' },
  ],
  resultReport: { id: 'report-1', status: 'RELEASED' },
} as unknown as LabOrderDetail;

function amendment(status: string): ActiveAmendmentSummary {
  return {
    amendmentId: 'amend-1',
    status,
    reason: 'Valor mal transcrito',
    orderedTestId: 'ot-1',
  } as ActiveAmendmentSummary;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orders/order-1/review']}>
        <Routes>
          <Route
            path="/orders/:orderId/review"
            element={<ReviewReleasePage />}
          />
          <Route path="/orders" element={<p>orders-list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// i18n isn't initialized in tests, so t() returns the keys.
describe('ReviewReleasePage — amendment awaiting approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canRelease = true;
    getById.mockResolvedValue(order);
    // Never resolves: the panel stays on its loading state
    getAmendment.mockReturnValue(new Promise(() => undefined));
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows a reviewer the banner with the test and reason', async () => {
    listActive.mockResolvedValue([amendment('IN_REVIEW')]);

    renderPage();

    const title = await screen.findByText('review.pending_amendments_banner');
    const banner = within(title.parentElement as HTMLElement);
    expect(banner.getByText('Urianálisis')).toBeTruthy();
    expect(banner.getByText(/Valor mal transcrito/)).toBeTruthy();
  });

  it('opens the amendment for the reviewer on arrival', async () => {
    listActive.mockResolvedValue([amendment('IN_REVIEW')]);

    renderPage();

    await waitFor(() =>
      expect(getAmendment).toHaveBeenCalledWith('order-1', 'amend-1')
    );
  });

  it('"Review amendment" scrolls to the test', async () => {
    listActive.mockResolvedValue([amendment('IN_REVIEW')]);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'review.pending_amendments_review',
      })
    );
    await new Promise((r) => requestAnimationFrame(r));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('shows nothing for a draft amendment (not sent for review yet)', async () => {
    listActive.mockResolvedValue([amendment('DRAFT')]);

    renderPage();

    expect(await screen.findByText('review.amend_continue')).toBeTruthy();
    expect(screen.queryByText('review.pending_amendments_banner')).toBeNull();
    expect(getAmendment).not.toHaveBeenCalled();
  });

  it('shows nothing to staff who cannot release', async () => {
    auth.canRelease = false;
    listActive.mockResolvedValue([amendment('IN_REVIEW')]);

    renderPage();

    expect(await screen.findByText('review.amend_continue')).toBeTruthy();
    expect(screen.queryByText('review.pending_amendments_banner')).toBeNull();
    expect(getAmendment).not.toHaveBeenCalled();
  });
});

describe('ReviewReleasePage — starting an amendment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canRelease = true;
    getById.mockResolvedValue(order);
  });

  it('does not reload the amendment it just created', async () => {
    // No open amendment until it is initiated; the refetch then returns it
    listActive.mockResolvedValueOnce([]);
    listActive.mockResolvedValue([amendment('DRAFT')]);
    initiate.mockResolvedValue({
      amendmentId: 'amend-1',
      status: 'DRAFT',
      analytes: [],
    } as unknown as Awaited<ReturnType<typeof labApi.amendment.initiate>>);

    renderPage();
    fireEvent.click(await screen.findByText('review.amend_btn'));
    fireEvent.change(
      screen.getByPlaceholderText('review.amend_reason_placeholder'),
      { target: { value: 'Valor mal transcrito' } }
    );
    fireEvent.click(screen.getByText('review.amend_initiate'));

    await waitFor(() => expect(listActive).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(getAmendment).not.toHaveBeenCalled();
  });
});

describe('ReviewReleasePage — after an amendment, back to the orders list', () => {
  const hgb = (numericValue: number) => ({
    id: 'aa-1',
    code: 'HGB',
    name: 'Hemoglobina',
    sectionName: null,
    sortOrder: 1,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'g/dL',
    formula: null,
    options: [],
    flag: null,
    referenceSnapshot: null,
  });
  // HGB corrected 12 → 15 in the draft
  const loaded = (status: string) =>
    ({
      amendment: {
        id: 'amend-1',
        status,
        reason: 'Valor mal transcrito',
        analytes: [hgb(15)],
      },
      sourceAnalytes: [hgb(12)],
    } as unknown as Awaited<ReturnType<typeof labApi.amendment.get>>);

  beforeEach(() => {
    vi.clearAllMocks();
    auth.canRelease = true;
    getById.mockResolvedValue(order);
  });

  it('after sending it for review', async () => {
    listActive.mockResolvedValue([amendment('DRAFT')]);
    getAmendment.mockResolvedValue(loaded('DRAFT'));
    submitForReview.mockResolvedValue({ status: 'IN_REVIEW' } as never);

    renderPage();
    fireEvent.click(await screen.findByText('review.amend_continue'));
    fireEvent.click(await screen.findByText('review.amend_submit_for_review'));

    expect(await screen.findByText('orders-list')).toBeTruthy();
    expect(submitForReview).toHaveBeenCalledWith('order-1', 'amend-1');
  });

  it('after approving it', async () => {
    listActive.mockResolvedValue([amendment('IN_REVIEW')]);
    getAmendment.mockResolvedValue(loaded('IN_REVIEW'));
    getReviewerSigners.mockResolvedValue([
      { id: 'signer-1', name: 'Dra. Ana', signatureUrl: 'data:x' },
    ] as never);
    approve.mockResolvedValue({} as never);

    renderPage();
    const reviewer = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: /Dra. Ana/ });
    fireEvent.change(reviewer, { target: { value: 'signer-1' } });
    fireEvent.click(screen.getByText('review.amend_approve'));

    expect(await screen.findByText('orders-list')).toBeTruthy();
    expect(approve).toHaveBeenCalledWith('order-1', 'amend-1', {
      signerId: 'signer-1',
      analystId: undefined,
    });
  });
});
