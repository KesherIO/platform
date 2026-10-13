import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import en from '../../../assets/i18n/en.json';

/** Real English strings, so labels and counts can be asserted. */
function translate(key: string, options?: Record<string, unknown>): unknown {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      en
    );
  if (options?.['returnObjects']) return value;
  if (typeof value !== 'string') return options?.['defaultValue'] ?? key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    String(options?.[name] ?? '')
  );
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('../../shared/api/labApi', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../shared/api/labApi')
  >();
  return {
    ApiError: actual.ApiError,
    labApi: { clients: { list: vi.fn(), export: vi.fn() } },
  };
});

vi.mock('./importLabels', () => ({ downloadCsv: vi.fn() }));

import { ApiError, labApi } from '../../shared/api/labApi';
import { downloadCsv } from './importLabels';
import { ExportClientsModal } from './ExportClientsModal';

const list = vi.mocked(labApi.clients.list);
const exportClients = vi.mocked(labApi.clients.export);
const download = vi.mocked(downloadCsv);

const row = {
  id: 'tenant-1',
  name: 'City Vet',
  legalName: null,
  primaryContactName: null,
  primaryContactEmail: 'info@cityvet.com',
  phone: null,
  address: null,
  city: null,
  country: 'CO',
  clientType: 'VETERINARY_CLINIC' as const,
  taxIdType: 'CC',
  taxId: '0012345',
  status: 'PENDING' as const,
};

function renderModal(
  props: Partial<Parameters<typeof ExportClientsModal>[0]> = {}
) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ExportClientsModal
        search=""
        filteredTotal={154}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onClose };
}

describe('ExportClientsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({
      data: [],
      total: 154,
      page: 1,
      pageSize: 1,
      totalPages: 154,
    });
    exportClients.mockResolvedValue({ rows: [row] });
  });

  it('without filters offers only all clients, with the page total', () => {
    renderModal();

    expect(screen.getByLabelText('All clients (154)')).toBeTruthy();
    expect(screen.queryByText(/Filtered list/)).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('with filters shows both counts and the filters, filtered list preselected', async () => {
    renderModal({ status: 'PENDING', search: 'vet', filteredTotal: 37 });

    expect(await screen.findByLabelText('All clients (154)')).toBeTruthy();
    expect(screen.getByLabelText('Filtered list (37)')).toHaveProperty(
      'checked',
      true
    );
    expect(screen.getByText('Pending, search “vet”')).toBeTruthy();
  });

  it('exports the filtered list with its filters and without notes by default', async () => {
    const { onClose } = renderModal({
      status: 'PENDING',
      search: 'vet',
      filteredTotal: 37,
    });

    fireEvent.click(screen.getByText('Download CSV'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportClients).toHaveBeenCalledWith({
      status: 'PENDING',
      search: 'vet',
      includeNotes: false,
    });
    const [csv, filename] = download.mock.calls[0];
    expect(csv).toContain('"Client ID","Name"');
    expect(csv).not.toContain('"Notes"');
    expect(csv).toContain('"0012345"');
    expect(filename).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('exports all clients without filters, with notes when checked', async () => {
    const { onClose } = renderModal({ status: 'ACTIVE', filteredTotal: 10 });

    fireEvent.click(screen.getByLabelText(/All clients/));
    fireEvent.click(screen.getByLabelText('Include internal notes'));
    fireEvent.click(screen.getByText('Download CSV'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportClients).toHaveBeenCalledWith({ includeNotes: true });
    expect(download.mock.calls[0][0]).toContain('"Status","Notes"');
  });

  it('explains the row cap instead of downloading a cut-off file', async () => {
    exportClients.mockRejectedValue(
      new ApiError(
        400,
        JSON.stringify({ code: 'EXPORT_TOO_LARGE', maxRows: 5000 })
      )
    );
    const { onClose } = renderModal();

    fireEvent.click(screen.getByText('Download CSV'));

    expect(await screen.findByText(/maximum 5000/)).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a generic error for anything else', async () => {
    exportClients.mockRejectedValue(new ApiError(500, 'boom'));
    renderModal();

    fireEvent.click(screen.getByText('Download CSV'));

    expect(
      await screen.findByText(en.clients.export.errors.generic)
    ).toBeTruthy();
  });
});
