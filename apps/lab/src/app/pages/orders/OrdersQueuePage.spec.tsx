import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const auth: { canRelease: boolean; labRole: string } = {
  canRelease: true,
  labRole: 'REVIEWER',
};
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('../../shared/api/labApi', () => ({
  labApi: { orders: { list: vi.fn(), reviewCount: vi.fn() } },
}));

import { labApi } from '../../shared/api/labApi';
import type { LabOrderSummary, OrderedTest } from '../../types/lab.types';
import { OrdersQueuePage } from './OrdersQueuePage';

const list = vi.mocked(labApi.orders.list);
const reviewCount = vi.mocked(labApi.orders.reviewCount);

const test = (status: string) => ({ id: status, status } as OrderedTest);

const order = {
  id: 'order-1',
  requisitionNumber: 'REQ-1',
  status: 'PROCESSING',
  priority: 'ROUTINE',
  patientName: 'Phoebe',
  patientSpecies: 'CAT',
  ownerName: 'Pepe',
  clinicName: 'Clínica Norte',
  createdAt: '2026-10-15T10:00:00Z',
  receivedByLabAt: null,
  orderedTests: [test('IN_REVIEW'), test('IN_REVIEW'), test('RESULTS_ENTERED')],
  amendmentsInReview: 1,
} as unknown as LabOrderSummary;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrdersQueuePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// i18n isn't initialized in tests, so t() returns the keys.
describe('OrdersQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({
      data: [order],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    reviewCount.mockResolvedValue({ count: 3 });
  });

  describe('as a reviewer', () => {
    beforeEach(() => {
      auth.canRelease = true;
      auth.labRole = 'REVIEWER';
    });

    it('opens on "Por revisar", with its count', async () => {
      renderPage();

      expect(
        await screen.findByRole('button', {
          name: 'orders.filter.for_review (3)',
        })
      ).toBeTruthy();
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ forReview: true, status: undefined })
      );
    });

    it('tags what is waiting for review, amendments and unsent results', async () => {
      renderPage();

      expect(await screen.findByText('orders.tags.for_review')).toBeTruthy();
      expect(screen.getByText('orders.tags.amendment_for_review')).toBeTruthy();
      expect(screen.getByText('orders.tags.not_submitted')).toBeTruthy();
    });
  });

  it('an admin also gets "Por revisar" but opens on All', async () => {
    auth.canRelease = true;
    auth.labRole = 'ADMIN';
    renderPage();

    expect(
      await screen.findByRole('button', {
        name: 'orders.filter.for_review (3)',
      })
    ).toBeTruthy();
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ forReview: false })
    );
  });

  describe('as an analyst', () => {
    beforeEach(() => {
      auth.canRelease = false;
      auth.labRole = 'ANALYST';
    });

    it('has no "Por revisar" filter or count', async () => {
      renderPage();
      await screen.findByText('Phoebe');

      expect(
        screen.queryByRole('button', { name: /orders\.filter\.for_review/ })
      ).toBeNull();
      expect(reviewCount).not.toHaveBeenCalled();
    });

    it('only sees the "not sent to review" tag', async () => {
      renderPage();
      await screen.findByText('Phoebe');

      expect(screen.getByText('orders.tags.not_submitted')).toBeTruthy();
      expect(screen.queryByText('orders.tags.for_review')).toBeNull();
      expect(screen.queryByText('orders.tags.amendment_for_review')).toBeNull();
    });
  });
});
