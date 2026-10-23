import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('../../shared/components/ToastProvider', () => ({
  useToast: () => toast,
}));
vi.mock('../../shared/api/labApi', () => ({
  labApi: { instruments: { orderStatus: vi.fn() } },
}));

import { labApi } from '../../shared/api/labApi';
import { AnalyzerNumberPanel } from './AnalyzerNumberPanel';
import type { OrderAnalyzerStatus } from '../../types/lab.types';

function show(status: OrderAnalyzerStatus | Error) {
  if (status instanceof Error)
    vi.mocked(labApi.instruments.orderStatus).mockRejectedValue(status);
  else vi.mocked(labApi.instruments.orderStatus).mockResolvedValue(status);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AnalyzerNumberPanel orderId="o12" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AnalyzerNumberPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the number to type into the analyzer, copies it, and shows what each analyzer sent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show({
      analyzerNumber: '26000012',
      analyzers: [
        {
          analyzerId: 'vh30',
          analyzerName: 'VH-30',
          state: 'IMPORTED',
          messageId: 'm1',
          reasons: [],
          at: '2026-10-22T10:00:05.000Z',
        },
        {
          analyzerId: 'chem',
          analyzerName: 'Chemistry',
          state: 'WAITING',
          messageId: null,
          reasons: [],
          at: null,
        },
      ],
    });
    expect(await screen.findByText('26000012')).toBeTruthy();
    expect(labApi.instruments.orderStatus).toHaveBeenCalledWith('o12');
    fireEvent.click(screen.getByText('instruments.connectors.copy'));
    expect(writeText).toHaveBeenCalledWith('26000012');
    expect(screen.getByText('instruments.order.state.IMPORTED')).toBeTruthy();
    expect(screen.getByText('instruments.order.state.WAITING')).toBeTruthy();
    expect(
      screen.getByText('instruments.order.open').getAttribute('href')
    ).toBe('/instruments?message=m1');
  });

  it('a legacy order number says to link results by hand', async () => {
    show({ analyzerNumber: null, analyzers: [] });
    expect(await screen.findByText('instruments.order.no_number')).toBeTruthy();
    expect(screen.queryByText('instruments.connectors.copy')).toBeNull();
  });

  it('renders nothing for a role without analyzer access (403)', async () => {
    const { container } = show(new Error('Forbidden'));
    await vi.waitFor(() =>
      expect(labApi.instruments.orderStatus).toHaveBeenCalled()
    );
    expect(container.textContent).toBe('');
  });
});
