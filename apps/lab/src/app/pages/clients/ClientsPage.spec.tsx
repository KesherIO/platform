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

describe('ClientsPage client card', () => {
  beforeEach(() => vi.clearAllMocks());

  const client = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'CLINICA Y PELUQUERIA CANINA LOS PERRITOS',
    clientType: 'VETERINARY_CLINIC',
    status: 'ACTIVE',
    primaryContactName: null,
    primaryContactEmail: 'ascontab2013@gmail.com',
    phone: '3024330161',
    address: 'Circunvalar 29 # 9-72, Barrio Lagos I',
    city: 'Floridablanca',
    country: 'CO',
    legalName: null,
    taxIdType: null,
    taxId: null,
    notes: null,
    userCount: 2,
    orderCount: 5,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  const renderWith = async (c: Record<string, unknown>) => {
    list.mockResolvedValue({ ...page(1), data: [c] } as never);
    renderPage();
    await screen.findByText(/^CLINICA|^Name/);
  };

  it('shows address, email, formatted phone and the type badge', async () => {
    await renderWith(client());

    expect(
      screen.getByText('Circunvalar 29 # 9-72, Barrio Lagos I, Floridablanca')
    ).toBeTruthy();
    expect(screen.getByText('ascontab2013@gmail.com')).toBeTruthy();
    expect(
      screen.getByText('clients.card.phone +57 302 433 0161')
    ).toBeTruthy();
    expect(screen.getByText('clients.type.VETERINARY_CLINIC')).toBeTruthy();
  });

  it('omits missing contact fields instead of leaving empty lines', async () => {
    await renderWith(
      client({
        address: null,
        city: null,
        phone: '  ',
        primaryContactEmail: null,
        clientType: null,
      })
    );

    expect(screen.queryByText(/clients\.card\.phone/)).toBeNull();
    expect(screen.queryByText(/clients\.type\./)).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('does not repeat the city when the address already has it', async () => {
    await renderWith(client({ address: 'Calle 1, Floridablanca' }));

    expect(screen.getByText('Calle 1, Floridablanca')).toBeTruthy();
  });

  it('shows an unreadable phone as stored', async () => {
    await renderWith(client({ phone: '302 433 0161 ext 4', country: null }));

    expect(
      screen.getByText('clients.card.phone 302 433 0161 ext 4')
    ).toBeTruthy();
  });
});
