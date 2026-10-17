import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../../shared/api/labApi', () => ({
  labApi: {
    catalog: { listActive: vi.fn() },
    specimens: { previewAddTests: vi.fn(), addTests: vi.fn() },
  },
  apiErrorMessage: (e: Error) => e.message,
}));

import { labApi } from '../../shared/api/labApi';
import { AddTestsDialog } from './AddTestsDialog';
import type { AddTestsPreview } from '../../types/lab.types';

const item = (id: string, name: string, active = true) => ({
  id,
  name,
  kind: 'TEST',
  active,
});

const preview = (over: Partial<AddTestsPreview> = {}): AddTestsPreview => ({
  tests: [
    {
      catalogItemId: 'chem',
      code: 'CHEM',
      name: 'Chemistry',
      origins: ['Chemistry'],
      outcome: 'NEEDS_NEW_TUBE',
    },
  ],
  alreadyOnOrder: [],
  tubes: [
    {
      specimenType: 'SERUM',
      containerType: 'SST_TUBE',
      existing: false,
      testNames: ['Chemistry'],
    },
  ],
  sampleRequired: true,
  ...over,
});

function renderDialog() {
  const onSuccess = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AddTestsDialog orderId="o-1" onClose={vi.fn()} onSuccess={onSuccess} />
    </QueryClientProvider>
  );
  return onSuccess;
}

// i18n isn't initialized in tests, so t() returns the keys.
describe('AddTestsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labApi.catalog.listActive).mockResolvedValue({
      data: [item('chem', 'Chemistry'), item('old', 'Retired', false)],
    } as never);
  });

  it('lists only active catalog items and disables Preview until one is picked', async () => {
    renderDialog();

    await screen.findByText('Chemistry');
    expect(screen.queryByText('Retired')).toBeNull();
    const previewBtn = screen.getByText('specimens.add_tests_preview');
    expect((previewBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews, warns a new sample is required with no pickup, then adds', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(preview());
    const result = {
      added: [{ id: 'ot-1', name: 'Chemistry', status: 'PENDING' }],
      alreadyOnOrder: [],
      sampleRequired: true,
      tubes: [],
      order: { id: 'o-1', status: 'RECEIVED_BY_LAB' },
    };
    vi.mocked(labApi.specimens.addTests).mockResolvedValue(result);
    const onSuccess = renderDialog();

    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));

    await screen.findByText('specimens.add_tests_sample_required');
    expect(labApi.specimens.previewAddTests).toHaveBeenCalledWith('o-1', [
      'chem',
    ]);
    expect(labApi.specimens.addTests).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('specimens.add_tests_confirm'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(labApi.specimens.addTests).toHaveBeenCalledWith(
      'o-1',
      ['chem'],
      undefined
    );
  });

  it('cannot confirm when every selected test is already on the order', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({
        tests: [],
        tubes: [],
        sampleRequired: false,
        alreadyOnOrder: [{ catalogItemId: 'chem', name: 'Chemistry' }],
      })
    );
    renderDialog();

    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));

    await screen.findByText('specimens.add_tests_nothing_new');
    const confirm = screen.getByText('specimens.add_tests_confirm');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the API error and stays on the preview', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(preview());
    vi.mocked(labApi.specimens.addTests).mockRejectedValue(
      new Error('The order is COMPLETED.')
    );
    const onSuccess = renderDialog();

    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));
    fireEvent.click(await screen.findByText('specimens.add_tests_confirm'));

    await screen.findByText('The order is COMPLETED.');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
