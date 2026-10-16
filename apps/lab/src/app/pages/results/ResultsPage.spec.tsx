import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const auth = { isResultsViewer: false, canViewInProgress: false };
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('../../shared/api/labApi', () => ({
  labApi: {
    results: { search: vi.fn(), clinics: vi.fn(), analytes: vi.fn() },
    release: { getCurrentResults: vi.fn(), getHistory: vi.fn() },
  },
}));

import { labApi } from '../../shared/api/labApi';
import type {
  InProgressResultRow,
  ReleasedResultRow,
  ResultsSearchQuery,
  ResultsSearchResponse,
  ResultsView,
} from '../../types/lab.types';
import { ResultsPage } from './ResultsPage';

const search = vi.mocked(labApi.results.search);

const released: ReleasedResultRow = {
  id: 'rt-1',
  releaseId: 'rel-2',
  releaseSequence: 2,
  releaseType: 'AMENDMENT',
  releasedAt: '2026-10-14T10:00:00Z',
  amended: true,
  orderId: 'order-1',
  requisitionNumber: 'REQ-1',
  clinicId: 'c-1',
  clinicName: 'Clínica Norte',
  patientName: 'Max',
  patientSpecies: 'DOG',
  ownerName: 'Ana',
  testName: 'Química',
  testCode: 'CHEM',
  analyte: null,
};

const inProgress: InProgressResultRow = {
  id: 't-9',
  status: 'IN_REVIEW',
  orderId: 'order-9',
  requisitionNumber: 'REQ-9',
  orderedAt: '2026-10-15T10:00:00Z',
  clinicId: 'c-1',
  clinicName: 'Clínica Norte',
  patientName: 'Kira',
  patientSpecies: 'CAT',
  ownerName: 'Luis',
  testName: 'Hemograma',
  testCode: 'CBC',
};

type Row = ReleasedResultRow | InProgressResultRow;

const response = (
  view: ResultsView,
  data: Row[]
): ResultsSearchResponse<Row> => ({
  data,
  total: data.length,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  view,
  dateFrom: '2026-09-16',
  dateTo: '2026-10-16',
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ResultsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// i18n isn't initialized in tests, so t() returns the keys.
describe('ResultsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.isResultsViewer = false;
    auth.canViewInProgress = false;
    vi.mocked(labApi.results.clinics).mockResolvedValue([
      { id: 'c-1', name: 'Clínica Norte' },
    ]);
    search.mockImplementation(async (q: ResultsSearchQuery) =>
      q.view === 'released'
        ? response('released', [released])
        : response('in_progress', [inProgress])
    );
  });

  it('lists released results with the corrected badge', async () => {
    renderPage();

    expect(await screen.findByText('Max')).toBeTruthy();
    expect(screen.getByText('results.amended')).toBeTruthy();
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'released', page: 1 })
    );
  });

  it('filters by clinic', async () => {
    renderPage();
    await screen.findByText('Max');
    await screen.findByRole('option', { name: 'Clínica Norte' });

    fireEvent.change(screen.getByLabelText('results.filters.clinic'), {
      target: { value: 'c-1' },
    });

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ clinicId: 'c-1' })
      )
    );
  });

  it('expands a row into the released report', async () => {
    vi.mocked(labApi.release.getCurrentResults).mockResolvedValue({
      tests: [],
    });
    vi.mocked(labApi.release.getHistory).mockResolvedValue({
      releases: [],
      aggregateReportStatus: 'ALL_RELEASED',
    });
    renderPage();

    fireEvent.click(await screen.findByText('Max'));

    await waitFor(() =>
      expect(labApi.release.getCurrentResults).toHaveBeenCalledWith('order-1')
    );
  });

  it('staff see the in-progress tab with statuses and a link to the order', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('tab', { name: 'results.tabs.in_progress' })
    );

    expect(await screen.findByText('Kira')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'REQ-9' }).getAttribute('href')
    ).toBe('/orders/order-9');
  });

  it('Consulta without the checkbox has no in-progress tab', async () => {
    auth.isResultsViewer = true;
    renderPage();

    await screen.findByText('Max');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('Consulta with the checkbox sees statuses but no link into the order', async () => {
    auth.isResultsViewer = true;
    auth.canViewInProgress = true;
    renderPage();

    fireEvent.click(
      await screen.findByRole('tab', { name: 'results.tabs.in_progress' })
    );

    expect(await screen.findByText('REQ-9')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'REQ-9' })).toBeNull();
  });
});
