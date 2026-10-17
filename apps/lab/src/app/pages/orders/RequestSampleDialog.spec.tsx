import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../../shared/api/labApi', () => ({
  labApi: { specimens: { requestSample: vi.fn(), getExpected: vi.fn() } },
  apiErrorMessage: (e: Error) => e.message,
}));

import { labApi } from '../../shared/api/labApi';
import { RequestSampleDialog } from './RequestSampleDialog';
import type { OrderedTest } from '../../types/lab.types';

const test = {
  id: 'ot-1',
  catalogItemName: 'T4',
  status: 'BLOCKED',
  blockReason: 'REJECTED_SPECIMEN',
} as OrderedTest;

function renderDialog() {
  const onSuccess = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RequestSampleDialog
        orderId="order-1"
        test={test}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>
  );
  return onSuccess;
}

// i18n isn't initialized in tests, so t() returns the keys.
describe('RequestSampleDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labApi.specimens.requestSample).mockResolvedValue({
      specimen: { id: 'sp-new', accessionNumber: 'REQ-1-3' },
    });
  });

  it('says the clinic is notified and no pickup is created, then requests', async () => {
    vi.mocked(labApi.specimens.getExpected).mockResolvedValue({
      expectedSpecimenGroups: [],
      unconfiguredTests: [],
      existingSpecimens: [],
    } as never);
    const onSuccess = renderDialog();

    expect(screen.getByText('specimens.request_sample_explainer')).toBeTruthy();
    const confirm = screen.getByText('specimens.request_sample_confirm');
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Coagulated' },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(labApi.specimens.requestSample).toHaveBeenCalledWith('ot-1', {
      note: 'Coagulated',
    });
  });

  it('asks which sample is needed when the test has no configured requirement', async () => {
    vi.mocked(labApi.specimens.getExpected).mockResolvedValue({
      expectedSpecimenGroups: [],
      unconfiguredTests: [{ id: 'ot-1', name: 'T4', code: 'T4' }],
      existingSpecimens: [],
    } as never);
    const onSuccess = renderDialog();

    expect(await screen.findByText('specimens.specimen_type')).toBeTruthy();
    fireEvent.click(screen.getByText('specimens.request_sample_confirm'));
    expect(
      await screen.findByText('specimens.request_sample_kind_required')
    ).toBeTruthy();

    const [type, container] = screen.getAllByRole('textbox');
    fireEvent.change(type, { target: { value: 'urine' } });
    fireEvent.change(container, { target: { value: 'urine cup' } });
    fireEvent.click(screen.getByText('specimens.request_sample_confirm'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(labApi.specimens.requestSample).toHaveBeenCalledWith('ot-1', {
      note: undefined,
      specimenType: 'URINE',
      containerType: 'URINE_CUP',
    });
  });
});
