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
      outcome: 'READY',
    },
  ],
  alreadyOnOrder: [],
  specimens: [
    {
      id: 'sp-1',
      accessionNumber: 'REQ-1-1',
      specimenType: 'SERUM',
      containerType: 'SST_TUBE',
      conditions: [],
      testNames: ['Chemistry'],
    },
  ],
  canAdd: true,
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

  it('previews, requires confirming each tube has enough sample, then adds', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(preview());
    const result = {
      added: [{ id: 'ot-1', name: 'Chemistry', status: 'READY' }],
      alreadyOnOrder: [],
      specimens: preview().specimens,
      order: { id: 'o-1', status: 'PROCESSING' },
    };
    vi.mocked(labApi.specimens.addTests).mockResolvedValue(result);
    const onSuccess = renderDialog();

    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));

    const tube = await screen.findByLabelText(
      'specimens.add_tests_confirm_specimen'
    );
    expect(labApi.specimens.previewAddTests).toHaveBeenCalledWith('o-1', [
      'chem',
    ]);
    const confirm = screen.getByText('specimens.add_tests_confirm');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(tube);
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(labApi.specimens.addTests).toHaveBeenCalledWith(
      'o-1',
      ['chem'],
      ['sp-1'],
      undefined
    );
  });

  it('shows conditions recorded at receipt next to the tube', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({
        specimens: [{ ...preview().specimens[0], conditions: ['isHemolyzed'] }],
      })
    );
    renderDialog();

    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));

    await screen.findByText('specimens.add_tests_conditions');
  });

  it.each(['AWAITING_SPECIMEN', 'NO_SPECIMEN', 'NO_REQUIREMENT'] as const)(
    'explains and cannot confirm when a test is %s',
    async (outcome) => {
      vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
        preview({
          tests: [{ ...preview().tests[0], outcome }],
          specimens: [],
          canAdd: false,
        })
      );
      renderDialog();

      fireEvent.click(await screen.findByLabelText(/Chemistry/));
      fireEvent.click(screen.getByText('specimens.add_tests_preview'));

      await screen.findByText(`specimens.add_tests_outcome.${outcome}`);
      expect(
        screen.getByText('specimens.add_tests_lab_samples_only')
      ).toBeTruthy();
      expect(
        screen.queryByText('specimens.add_tests_confirm_title')
      ).toBeNull();
      const confirm = screen.getByText('specimens.add_tests_confirm');
      expect((confirm as HTMLButtonElement).disabled).toBe(true);
    }
  );

  it('cannot confirm when every selected test is already on the order', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({
        tests: [],
        specimens: [],
        canAdd: false,
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
    fireEvent.click(
      await screen.findByLabelText('specimens.add_tests_confirm_specimen')
    );
    fireEvent.click(screen.getByText('specimens.add_tests_confirm'));

    await screen.findByText('The order is COMPLETED.');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
