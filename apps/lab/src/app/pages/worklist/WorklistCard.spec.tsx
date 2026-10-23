import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { WorklistCard } from './WorklistCard';
import type { WorklistItem } from '../../types/lab.types';

const item = (over: Partial<WorklistItem> = {}) =>
  ({
    id: 't1',
    catalogItemName: 'Hemograma',
    catalogItemCode: 'CBC',
    status: 'READY',
    version: 3,
    createdAt: '2026-10-22T10:00:00.000Z',
    orderId: 'o13',
    requisitionNumber: 'REQ-2026-000013',
    analyzerNumber: '26000013',
    orderPriority: 'ROUTINE',
    patientName: 'Laika',
    clinicName: 'Clinic',
    assignedUserId: null,
    assignedUserName: null,
    accessionNumber: null,
    ...over,
  } as WorklistItem);

function show(i: WorklistItem) {
  const onClaim = vi.fn();
  render(
    <MemoryRouter>
      <WorklistCard
        item={i}
        currentUserId="u1"
        isAdmin={false}
        onClaim={onClaim}
        onUnclaim={vi.fn()}
        onStart={vi.fn()}
        onReassign={vi.fn()}
        busy={false}
      />
    </MemoryRouter>
  );
  return { onClaim };
}

describe('WorklistCard', () => {
  afterEach(cleanup);

  it('shows the analyzer number next to the requisition number', () => {
    show(item());
    expect(screen.getByText('#26000013')).toBeTruthy();
  });

  it('a test the analyzer already imported as a draft (IN_PROGRESS, nobody assigned) can be claimed', () => {
    const { onClaim } = show(item({ status: 'IN_PROGRESS' }));
    fireEvent.click(screen.getByText('worklist.actions.claim'));
    expect(onClaim).toHaveBeenCalledWith('t1', 3);
    expect(screen.queryByText('worklist.actions.start')).toBeNull();
  });

  it('once claimed, it goes straight to entering results (no start step)', () => {
    show(
      item({
        status: 'IN_PROGRESS',
        assignedUserId: 'u1',
        assignedUserName: 'Ana',
      })
    );
    expect(screen.queryByText('worklist.actions.claim')).toBeNull();
    expect(screen.queryByText('worklist.actions.start')).toBeNull();
    expect(
      screen.getByText('worklist.actions.enter_results').getAttribute('href')
    ).toBe('/orders/o13/tests/t1/results');
  });

  it("someone else's test cannot be claimed", () => {
    show(item({ status: 'IN_PROGRESS', assignedUserId: 'u2' }));
    expect(screen.queryByText('worklist.actions.claim')).toBeNull();
  });
});
