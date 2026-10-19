import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../shared/api/labApi', () => ({
  labApi: {
    catalog: {
      create: vi.fn(),
      update: vi.fn(),
      listActive: vi.fn().mockResolvedValue({ data: [] }),
    },
  },
}));

import { labApi } from '../../shared/api/labApi';
import { CatalogItemModal } from './CatalogItemModal';
import type { CatalogItem } from '../../types/lab.types';

const flagged: CatalogItem = {
  id: 'c1',
  kind: 'TEST',
  name: 'Copro mx 1',
  code: 'copro1',
  packageComponentOnly: true,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// i18n isn't initialized in tests, so t() returns the keys.
describe('CatalogItemModal — package only', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the checkbox ticked for a package-only test and un-ticking sends false', async () => {
    vi.mocked(labApi.catalog.update).mockResolvedValue(flagged);
    const onSaved = vi.fn();
    render(
      <CatalogItemModal
        mode="edit"
        item={flagged}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    const box = screen.getByLabelText(/catalog\.form\.package_only/);
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    fireEvent.submit(box.closest('form') as HTMLFormElement);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(vi.mocked(labApi.catalog.update).mock.calls[0][1]).toMatchObject({
      packageComponentOnly: false,
    });
  });

  it('creating a test leaves the flag out unless ticked', async () => {
    vi.mocked(labApi.catalog.create).mockResolvedValue(flagged);
    const onSaved = vi.fn();
    const { container } = render(
      <CatalogItemModal mode="create" onClose={vi.fn()} onSaved={onSaved} />
    );
    fireEvent.change(container.querySelector('input[required]') as Element, {
      target: { value: 'Copro mx 2' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(vi.mocked(labApi.catalog.create).mock.calls[0][0]).toMatchObject({
      packageComponentOnly: undefined,
    });
  });

  it('ticking it while creating sends true', async () => {
    vi.mocked(labApi.catalog.create).mockResolvedValue(flagged);
    const onSaved = vi.fn();
    const { container } = render(
      <CatalogItemModal mode="create" onClose={vi.fn()} onSaved={onSaved} />
    );
    fireEvent.change(container.querySelector('input[required]') as Element, {
      target: { value: 'Copro mx 2' },
    });
    fireEvent.click(screen.getByLabelText(/catalog\.form\.package_only/));
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(vi.mocked(labApi.catalog.create).mock.calls[0][0]).toMatchObject({
      packageComponentOnly: true,
    });
  });

  it('a package has no such checkbox', () => {
    render(
      <CatalogItemModal
        mode="edit"
        item={{ ...flagged, kind: 'PACKAGE', packageComponentOnly: false }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/catalog\.form\.package_only/)).toBeNull();
  });
});
