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
    amendment: { listActive: vi.fn(), get: vi.fn() },
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
