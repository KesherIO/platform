import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../shared/api/labApi', () => ({
  labApi: { specimens: { getExpected: vi.fn(), accessionOrder: vi.fn() } },
}));

import { labApi } from '../../shared/api/labApi';
import { AccessionDialog } from './AccessionDialog';
import type { ExpectedSpecimensResponse } from '../../types/lab.types';

const twoCopros: ExpectedSpecimensResponse = {
  expectedSpecimenGroups: [
    {
      specimenType: 'FECES',
      containerType: 'FRASCO_COPRO_1',
      tests: [{ id: 't1', name: 'Copro mx 1', code: 'copro1' }],
      minimumVolumeMl: null,
    },
    {
      specimenType: 'FECES',
      containerType: 'FRASCO_COPRO_2',
      tests: [{ id: 't2', name: 'Copro mx 2', code: 'copro2' }],
      minimumVolumeMl: null,
    },
  ],
  unconfiguredTests: [],
  existingSpecimens: [],
};

// i18n isn't initialized in tests, so t() returns the keys.
describe('AccessionDialog — samples not received yet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labApi.specimens.getExpected).mockResolvedValue(twoCopros);
    vi.mocked(labApi.specimens.accessionOrder).mockResolvedValue({
      specimens: [],
      order: { id: 'o-1', status: 'RECEIVED_BY_LAB' },
    } as never);
  });

  async function open() {
    const onSuccess = vi.fn();
    render(
      <AccessionDialog
        orderId="o-1"
        requisitionNumber="REQ-1"
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    );
    await screen.findAllByText('accession.awaiting');
    return onSuccess;
  }

  it('offers Accept, Reject and Not received yet for every sample', async () => {
    await open();
    expect(screen.getAllByText('accession.accept')).toHaveLength(2);
    expect(screen.getAllByText('accession.reject')).toHaveLength(2);
    expect(screen.getAllByText('accession.awaiting')).toHaveLength(2);
  });

  it('accessions only the first sample, sending the second as awaiting', async () => {
    const onSuccess = await open();

    fireEvent.click(screen.getAllByText('accession.awaiting')[1]);
    fireEvent.click(screen.getByText('accession.confirm'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const sent = vi.mocked(labApi.specimens.accessionOrder).mock.calls[0][1];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      containerType: 'FRASCO_COPRO_1',
      accepted: true,
      awaiting: false,
    });
    expect(sent[1]).toMatchObject({
      containerType: 'FRASCO_COPRO_2',
      awaiting: true,
      accepted: false,
    });
  });

  it('needs no rejection reason for a sample that is not here yet', async () => {
    await open();
    fireEvent.click(screen.getAllByText('accession.awaiting')[1]);
    expect(screen.queryByText('accession.rejection_reason')).toBeNull();
    // the hint explains what happens
    expect(screen.getByText('accession.awaiting_hint')).toBeTruthy();
  });

  it('refuses to confirm when nothing is received', async () => {
    await open();
    fireEvent.click(screen.getAllByText('accession.awaiting')[0]);
    fireEvent.click(screen.getAllByText('accession.awaiting')[1]);
    fireEvent.click(screen.getByText('accession.confirm'));

    expect(await screen.findByText('accession.all_awaiting')).toBeTruthy();
    expect(labApi.specimens.accessionOrder).not.toHaveBeenCalled();
  });

  it('a tube still expected shows as not received yet when reopened', async () => {
    vi.mocked(labApi.specimens.getExpected).mockResolvedValue({
      ...twoCopros,
      existingSpecimens: [
        {
          id: 'sp-1',
          accessionNumber: 'REQ-1',
          specimenType: 'FECES',
          containerType: 'FRASCO_COPRO_1',
          tubeIndex: 1,
          status: 'ACCEPTED',
        },
        {
          id: 'sp-2',
          accessionNumber: 'REQ-1-2',
          specimenType: 'FECES',
          containerType: 'FRASCO_COPRO_2',
          tubeIndex: 1,
          status: 'EXPECTED',
        },
      ] as never,
    });
    await open();
    // the expected tube is already marked, so only its hint is on screen
    expect(screen.getAllByText('accession.awaiting_hint')).toHaveLength(1);
    expect(screen.queryByText('accession.rejection_reason')).toBeNull();
  });

  it('a slow second response (StrictMode runs the load twice) never resets what was just clicked', async () => {
    // StrictMode makes two requests. Answer the first, let the user click the
    // moment anything is on screen, and only then answer the second.
    const pending: Array<(v: ExpectedSpecimensResponse) => void> = [];
    vi.mocked(labApi.specimens.getExpected).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        })
    );
    render(
      <StrictMode>
        <AccessionDialog
          orderId="o-1"
          requisitionNumber="REQ-1"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </StrictMode>
    );
    expect(pending).toHaveLength(2);

    await act(async () => pending[0](twoCopros));
    const early = screen.queryAllByText('accession.awaiting');
    if (early.length > 0) fireEvent.click(early[1]);

    await act(async () => pending[1](twoCopros));
    if (early.length === 0) {
      fireEvent.click(screen.getAllByText('accession.awaiting')[1]);
    }

    // the click is what's on screen: not-received selected, accept not
    expect(screen.getByText('accession.awaiting_hint')).toBeTruthy();
    expect(screen.getAllByText('accession.awaiting')[1].className).toContain(
      'bg-amber-600'
    );
    expect(screen.getAllByText('accession.accept')[1].className).not.toContain(
      'bg-emerald-600'
    );
  });
});
