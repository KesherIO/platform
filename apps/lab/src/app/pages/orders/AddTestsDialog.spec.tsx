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
import type { AddTestsPreview, AddTestsSpecimen } from '../../types/lab.types';

const item = (id: string, name: string, active = true) => ({
  id,
  name,
  kind: 'TEST',
  active,
});

const sample = (id: string, over: Partial<AddTestsSpecimen> = {}) => ({
  id,
  accessionNumber: `REQ-1-${id}`,
  specimenType: 'SERUM',
  containerType: 'SST_TUBE',
  conditions: [],
  ...over,
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
  sampleMode: 'SELECT_ACCEPTED',
  acceptedSpecimens: [sample('sp-1'), sample('sp-2')],
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

  async function openPreview() {
    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));
    await screen.findByText('specimens.add_tests_pick_samples');
  }

  const confirmButton = () =>
    screen.getByText('specimens.add_tests_confirm') as HTMLButtonElement;
  const sampleBoxes = () =>
    screen.getAllByLabelText('specimens.add_tests_specimen');
  const suitableBox = () =>
    screen.getByLabelText(
      'specimens.add_tests_confirm_suitable'
    ) as HTMLInputElement;

  it('requires picking a sample and confirming it is suitable, then adds', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(preview());
    const result = {
      added: [{ id: 'ot-1', name: 'Chemistry', status: 'READY' }],
      alreadyOnOrder: [],
      specimens: [sample('sp-2')],
      order: { id: 'o-1', status: 'PROCESSING' },
    };
    vi.mocked(labApi.specimens.addTests).mockResolvedValue(result);
    const onSuccess = renderDialog();

    await openPreview();
    expect(labApi.specimens.previewAddTests).toHaveBeenCalledWith('o-1', [
      'chem',
    ]);
    expect(sampleBoxes()).toHaveLength(2);
    // Nothing picked yet: can't confirm or add
    expect(suitableBox().disabled).toBe(true);
    expect(confirmButton().disabled).toBe(true);

    fireEvent.click(sampleBoxes()[1]);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(suitableBox());
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(labApi.specimens.addTests).toHaveBeenCalledWith(
      'o-1',
      ['chem'],
      ['sp-2'],
      true,
      undefined
    );
  });

  it('pre-picks the only accepted sample, but still asks for the confirmation', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({ acceptedSpecimens: [sample('sp-1')] })
    );
    renderDialog();

    await openPreview();

    expect((sampleBoxes()[0] as HTMLInputElement).checked).toBe(true);
    expect(suitableBox().checked).toBe(false);
    expect(confirmButton().disabled).toBe(true);
  });

  it('clears the confirmation when the picked samples change', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(preview());
    renderDialog();

    await openPreview();
    fireEvent.click(sampleBoxes()[0]);
    fireEvent.click(suitableBox());
    expect(suitableBox().checked).toBe(true);

    fireEvent.click(sampleBoxes()[1]);
    expect(suitableBox().checked).toBe(false);
    expect(confirmButton().disabled).toBe(true);
  });

  it('shows conditions recorded at receipt next to the sample', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({
        acceptedSpecimens: [sample('sp-1', { conditions: ['isHemolyzed'] })],
      })
    );
    renderDialog();

    await openPreview();

    expect(screen.getByText('specimens.add_tests_conditions')).toBeTruthy();
  });

  it.each(['NO_ACCEPTED_SPECIMEN', 'NOT_RECEIVED'] as const)(
    'explains and cannot add when the sample mode is %s',
    async (sampleMode) => {
      vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
        preview({ sampleMode, acceptedSpecimens: [], canAdd: false })
      );
      renderDialog();

      fireEvent.click(await screen.findByLabelText(/Chemistry/));
      fireEvent.click(screen.getByText('specimens.add_tests_preview'));

      await screen.findByText(`specimens.add_tests_sample_mode.${sampleMode}`);
      expect(screen.queryByText('specimens.add_tests_pick_samples')).toBeNull();
      expect(
        screen.queryByLabelText('specimens.add_tests_confirm_suitable')
      ).toBeNull();
      expect(confirmButton().disabled).toBe(true);
    }
  );

  it('for a received order with no specimen records, asks only to confirm the received sample', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({ sampleMode: 'CONFIRM_RECEIVED_ORDER', acceptedSpecimens: [] })
    );
    const result = {
      added: [{ id: 'ot-1', name: 'Chemistry', status: 'READY' }],
      alreadyOnOrder: [],
      specimens: [],
      order: { id: 'o-1', status: 'PROCESSING' },
    };
    vi.mocked(labApi.specimens.addTests).mockResolvedValue(result);
    const onSuccess = renderDialog();

    fireEvent.click(await screen.findByLabelText(/Chemistry/));
    fireEvent.click(screen.getByText('specimens.add_tests_preview'));

    await screen.findByText(
      'specimens.add_tests_sample_mode.CONFIRM_RECEIVED_ORDER'
    );
    expect(screen.queryByText('specimens.add_tests_pick_samples')).toBeNull();
    const received = screen.getByLabelText(
      'specimens.add_tests_confirm_received_sample'
    ) as HTMLInputElement;
    expect(received.disabled).toBe(false);
    expect(confirmButton().disabled).toBe(true);

    fireEvent.click(received);
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(labApi.specimens.addTests).toHaveBeenCalledWith(
      'o-1',
      ['chem'],
      [],
      true,
      undefined
    );
  });

  it('cannot confirm when every selected test is already on the order', async () => {
    vi.mocked(labApi.specimens.previewAddTests).mockResolvedValue(
      preview({
        tests: [],
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
    await screen.findByText('specimens.add_tests_pick_samples');
    fireEvent.click(sampleBoxes()[0]);
    fireEvent.click(suitableBox());
    fireEvent.click(confirmButton());

    await screen.findByText('The order is COMPLETED.');
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
