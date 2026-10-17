import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../shared/api/labApi', () => ({
  labApi: { specimens: { receive: vi.fn() } },
  apiErrorMessage: (e: Error) => e.message,
}));

import { labApi } from '../../shared/api/labApi';
import { ReceiveSpecimenDialog } from './ReceiveSpecimenDialog';
import type { Specimen } from '../../types/lab.types';

const specimen = {
  id: 'sp-2',
  accessionNumber: 'REQ-1-2',
  specimenType: 'SERUM',
  containerType: 'SST_TUBE',
  status: 'EXPECTED',
} as Specimen;

// i18n isn't initialized in tests, so t() returns the keys.
describe('ReceiveSpecimenDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  function renderDialog() {
    const onSuccess = vi.fn();
    render(
      <ReceiveSpecimenDialog
        specimen={specimen}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    );
    return onSuccess;
  }

  it('accepts the tube with its requested accession number', async () => {
    vi.mocked(labApi.specimens.receive).mockResolvedValue({
      specimen: { id: 'sp-2', status: 'ACCEPTED' },
      tests: [],
      order: { id: 'o-1', status: 'RECEIVED_BY_LAB' },
    });
    const onSuccess = renderDialog();

    fireEvent.click(screen.getByText('specimens.receive_confirm'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(labApi.specimens.receive).toHaveBeenCalledWith('sp-2', {
      accepted: true,
      accessionNumber: 'REQ-1-2',
      rejectionReason: undefined,
      notes: undefined,
    });
  });

  it('needs a reason or a condition to reject', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('accession.reject'));
    fireEvent.click(screen.getByText('specimens.receive_confirm'));

    expect(
      await screen.findByText('accession.rejection_reason_required')
    ).toBeTruthy();
    expect(labApi.specimens.receive).not.toHaveBeenCalled();
  });

  it('a condition flag rejects without a typed reason', async () => {
    vi.mocked(labApi.specimens.receive).mockResolvedValue({
      specimen: { id: 'sp-2', status: 'REJECTED' },
      tests: [],
      order: { id: 'o-1', status: 'RECEIVED_BY_LAB' },
    });
    const onSuccess = renderDialog();
    fireEvent.click(screen.getByText('accession.flag.isHemolyzed'));
    fireEvent.click(screen.getByText('specimens.receive_confirm'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(labApi.specimens.receive).toHaveBeenCalledWith(
      'sp-2',
      expect.objectContaining({ accepted: false, isHemolyzed: true })
    );
  });
});
