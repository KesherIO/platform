import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../api/labApi', () => ({
  labApi: {
    notifications: {
      unreadCount: vi.fn(),
      list: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    },
  },
}));

import { labApi } from '../api/labApi';
import { NotificationBell } from './NotificationBell';
import type { LabNotification } from '../../types/lab.types';

const notification = (
  overrides: Partial<LabNotification> = {}
): LabNotification => ({
  id: 'n-1',
  type: 'PICKUP_ASSIGNED',
  tenantId: 'lab-1',
  pickupId: 'p-1',
  params: { requisitionNumber: 'REQ-2026-000042' },
  link: '/my-pickups',
  createdAt: '2026-10-18T10:00:00.000Z',
  ...overrides,
});

function renderBell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route path="/orders" element={<NotificationBell />} />
          <Route path="/my-pickups" element={<p>my pickups page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// i18n isn't initialized in tests, so t() returns the keys.
describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labApi.notifications.unreadCount).mockResolvedValue({
      count: 2,
      otherTenants: [],
    });
    vi.mocked(labApi.notifications.list).mockResolvedValue({
      items: [
        notification(),
        notification({
          id: 'n-2',
          type: 'PICKUP_CANCELLED',
          readAt: '2026-10-18T11:00:00.000Z',
        }),
      ],
      nextCursor: null,
    });
    vi.mocked(labApi.notifications.markRead).mockResolvedValue({ read: true });
    vi.mocked(labApi.notifications.markAllRead).mockResolvedValue({
      updated: 2,
    });
  });

  it('shows the unread count and loads the list only when opened', async () => {
    renderBell();

    expect(await screen.findByText('2')).toBeTruthy();
    expect(labApi.notifications.list).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'notifications.bell_unread' })
    );

    expect(
      await screen.findByText('notifications.types.PICKUP_ASSIGNED')
    ).toBeTruthy();
    expect(
      screen.getByText('notifications.types.PICKUP_CANCELLED')
    ).toBeTruthy();
    expect(labApi.notifications.list).toHaveBeenCalledWith(undefined);
  });

  it('opening an unread notification marks it read and follows its link', async () => {
    renderBell();
    fireEvent.click(
      await screen.findByRole('button', { name: 'notifications.bell_unread' })
    );
    fireEvent.click(
      await screen.findByText('notifications.types.PICKUP_ASSIGNED')
    );

    expect(await screen.findByText('my pickups page')).toBeTruthy();
    expect(labApi.notifications.markRead).toHaveBeenCalledWith('n-1');
  });

  it('opening a read one does not mark it again', async () => {
    renderBell();
    fireEvent.click(
      await screen.findByRole('button', { name: 'notifications.bell_unread' })
    );
    fireEvent.click(
      await screen.findByText('notifications.types.PICKUP_CANCELLED')
    );

    expect(await screen.findByText('my pickups page')).toBeTruthy();
    expect(labApi.notifications.markRead).not.toHaveBeenCalled();
  });

  it('marks everything read', async () => {
    renderBell();
    fireEvent.click(
      await screen.findByRole('button', { name: 'notifications.bell_unread' })
    );
    fireEvent.click(await screen.findByText('notifications.mark_all_read'));

    await waitFor(() =>
      expect(labApi.notifications.markAllRead).toHaveBeenCalledTimes(1)
    );
  });

  it('shows an empty state', async () => {
    vi.mocked(labApi.notifications.unreadCount).mockResolvedValue({
      count: 0,
      otherTenants: [],
    });
    vi.mocked(labApi.notifications.list).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'notifications.bell' }));

    expect(await screen.findByText('notifications.empty')).toBeTruthy();
  });
});
