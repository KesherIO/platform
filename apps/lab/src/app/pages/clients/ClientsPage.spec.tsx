import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true, tenantName: 'Kesher Lab' }),
}));

vi.mock('../../shared/api/labApi', () => ({
  labApi: { clients: { list: vi.fn() } },
}));

import { labApi } from '../../shared/api/labApi';
import { ClientsPage } from './ClientsPage';

const list = vi.mocked(labApi.clients.list);

const page = (total: number) => ({
  data: [],
  total,
  page: 1,
  pageSize: 20,
  totalPages: Math.ceil(total / 20),
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ClientsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// i18n isn't initialized in tests, so t() returns the keys.
const exportButton = () =>
  screen.getByRole('button', { name: 'clients.export_clients' });

describe('ClientsPage export button', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is disabled when the lab has no clients', async () => {
    list.mockResolvedValue(page(0));
    renderPage();

    await waitFor(() =>
      expect(exportButton()).toHaveProperty('disabled', true)
    );
    expect(exportButton().getAttribute('title')).toBe(
      'clients.export.no_clients'
    );
  });

  it('stays enabled when only the filters return nothing', async () => {
    list.mockResolvedValue(page(3));
    renderPage();
    await waitFor(() => expect(list).toHaveBeenCalled());

    list.mockResolvedValue(page(0));
    fireEvent.click(screen.getByText('clients.filter.suspended'));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'SUSPENDED' })
      )
    );
    expect(exportButton()).toHaveProperty('disabled', false);
  });

  it('is enabled when the lab has clients', async () => {
    list.mockResolvedValue(page(3));
    renderPage();

    await screen.findByText(/^3/);
    expect(exportButton()).toHaveProperty('disabled', false);
  });
});
