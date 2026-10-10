import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { ClientDetail } from '../../types/lab.types';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true, tenantName: 'Kesher Lab' }),
}));

vi.mock('../../shared/api/labApi', () => ({
  labApi: {
    clients: {
      getById: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { labApi } from '../../shared/api/labApi';
import { ConfirmDialogProvider } from '../../shared/components/ConfirmDialogProvider';
import { ClientDetailPage } from './ClientDetailPage';

const getById = vi.mocked(labApi.clients.getById);
const update = vi.mocked(labApi.clients.update);

function makeClient(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: 'clinic-1',
    name: 'City Vet Clinic',
    clientType: 'VETERINARY_CLINIC',
    status: 'ACTIVE',
    primaryContactName: 'Dr. Ana Gómez',
    primaryContactEmail: 'info@cityvet.com',
    phone: '+57 300 111 2222',
    address: 'Calle 10 #20-30',
    city: 'Bogotá',
    country: 'CO',
    legalName: null,
    taxIdType: null,
    taxId: null,
    notes: null,
    userCount: 1,
    orderCount: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    laboratoryName: 'Kesher Lab',
    pickupEnabled: false,
    defaultDeliveryMethod: null,
    pickupAddress: null,
    pickupContactName: null,
    pickupContactPhone: null,
    collectionHours: null,
    pickupInstructions: null,
    users: [],
    recentOrders: [],
    invitation: null,
    ...overrides,
  } as ClientDetail;
}

function renderDetail(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <MemoryRouter initialEntries={['/clients/clinic-1']}>
          <Routes>
            <Route path="/clients/:id" element={<ClientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ConfirmDialogProvider>
    </QueryClientProvider>
  );
}

describe('ClientDetailPage — shared clinic profile', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('shows changes the clinic made in its own app when the client is reopened', async () => {
    getById.mockResolvedValueOnce(makeClient()).mockResolvedValueOnce(
      makeClient({
        phone: '+57 310 999 8888',
        city: 'Medellín',
        primaryContactName: null,
      })
    );

    const first = renderDetail(queryClient);
    expect(await screen.findByText('+57 300 111 2222')).toBeTruthy();
    first.unmount();

    // Same query cache, as when navigating away and back in the lab portal.
    renderDetail(queryClient);
    expect(await screen.findByText('+57 310 999 8888')).toBeTruthy();
    expect(screen.getByText('Medellín')).toBeTruthy();
    expect(screen.queryByText('Dr. Ana Gómez')).toBeNull();
    expect(getById).toHaveBeenCalledTimes(2);
  });

  it('saves the full profile and sends cleared fields as empty strings', async () => {
    getById.mockResolvedValue(makeClient());
    update.mockResolvedValue({});

    renderDetail(queryClient);
    // First "edit" is the client info card; collection settings has its own.
    const [editInfo] = await screen.findAllByText('clients.detail.edit');
    fireEvent.click(editInfo);

    fireEvent.change(screen.getByDisplayValue('+57 300 111 2222'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByDisplayValue('Bogotá'), {
      target: { value: 'Cali' },
    });
    fireEvent.click(screen.getByText('clients.detail.save'));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('clinic-1', {
        name: 'City Vet Clinic',
        primaryContactName: 'Dr. Ana Gómez',
        primaryContactEmail: 'info@cityvet.com',
        phone: '',
        address: 'Calle 10 #20-30',
        city: 'Cali',
        country: 'CO',
        legalName: '',
        taxIdType: '',
        taxId: '',
        notes: '',
      })
    );
  });

  it('shows the tax ID and notes, and clears an ID type that the new country does not use', async () => {
    getById.mockResolvedValue(
      makeClient({
        legalName: 'City Vet SAS',
        taxIdType: 'NIT',
        taxId: '900.123.456-7',
        notes: 'Pays monthly',
      })
    );
    update.mockResolvedValue({});

    renderDetail(queryClient);
    expect(await screen.findByText('900.123.456-7')).toBeTruthy();
    expect(screen.getByText('Pays monthly')).toBeTruthy();

    const [editInfo] = screen.getAllByText('clients.detail.edit');
    fireEvent.click(editInfo);
    const countrySelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).value === 'CO');
    fireEvent.change(countrySelect!, { target: { value: 'CL' } });
    fireEvent.click(screen.getByText('clients.detail.save'));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'clinic-1',
        expect.objectContaining({
          country: 'CL',
          taxIdType: '',
          taxId: '900.123.456-7',
          legalName: 'City Vet SAS',
          notes: 'Pays monthly',
        })
      )
    );
  });
});
