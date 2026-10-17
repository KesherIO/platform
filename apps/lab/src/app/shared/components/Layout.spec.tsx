import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

const auth = {
  user: { email: 'ana@lab.test' },
  tenantName: 'Test Lab',
  logoUrl: null,
  isAdmin: false,
  canRelease: false,
  labRole: 'ANALYST',
  canPerformPickups: false,
  vetVerificationRequired: false,
  isResultsViewer: false,
  signOut: vi.fn(),
};
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('../api/labApi', () => ({
  labApi: {
    pickups: { unassignedCount: vi.fn(), myPickups: vi.fn() },
    worklist: { readyCount: vi.fn() },
    verifications: { getPendingCount: vi.fn() },
    orders: { reviewCount: vi.fn() },
    notifications: {
      unreadCount: vi.fn(),
      list: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
    },
  },
}));

import { labApi } from '../api/labApi';
import { Layout } from './Layout';

const ADMIN_TABS = [
  'nav.test_config',
  'nav.templates',
  'nav.collections',
  'nav.clients',
  'nav.catalog',
  'nav.team',
  'nav.settings',
];

function renderAt(
  path: string,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/orders" element={<p>orders page</p>} />
            <Route path="/clients" element={<p>clients page</p>} />
            <Route path="/templates/*" element={<p>templates page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Tab labels in the desktop sidebar (the mobile drawer repeats them) */
const tab = (label: string) => screen.queryAllByText(label)[0] ?? null;

// i18n isn't initialized in tests, so t() returns the keys.
describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labApi.pickups.unassignedCount).mockResolvedValue({ count: 0 });
    vi.mocked(labApi.pickups.myPickups).mockResolvedValue([]);
    vi.mocked(labApi.worklist.readyCount).mockResolvedValue({ count: 0 });
    vi.mocked(labApi.orders.reviewCount).mockResolvedValue({ count: 4 });
    vi.mocked(labApi.notifications.unreadCount).mockResolvedValue({
      count: 0,
      otherTenants: [],
    });
    Object.assign(auth, {
      isAdmin: false,
      canRelease: false,
      labRole: 'ANALYST',
      canPerformPickups: false,
    });
  });

  it('an analyst only gets the work tabs', () => {
    renderAt('/orders');

    for (const label of ['nav.orders_queue', 'nav.worklist', 'nav.results']) {
      expect(tab(label)).toBeTruthy();
    }
    for (const label of [...ADMIN_TABS, 'nav.my_pickups']) {
      expect(tab(label)).toBeNull();
    }
    expect(labApi.orders.reviewCount).not.toHaveBeenCalled();
    expect(labApi.pickups.unassignedCount).not.toHaveBeenCalled();
  });

  it('an analyst who does pickups also gets My Pickups', () => {
    auth.canPerformPickups = true;
    renderAt('/orders');

    expect(tab('nav.my_pickups')).toBeTruthy();
    expect(tab('nav.collections')).toBeNull();
  });

  it.each(['/clients', '/templates/def-1/versions/v-1/edit'])(
    'sends a non-admin from %s back to the orders queue',
    (path) => {
      renderAt(path);

      expect(screen.getByText('orders page')).toBeTruthy();
    }
  );

  it('a reviewer sees how many orders wait for review on the Orders queue tab', async () => {
    auth.canRelease = true;
    auth.labRole = 'REVIEWER';
    renderAt('/orders');

    expect((await screen.findAllByText('4')).length).toBeGreaterThan(0);
    expect(tab('nav.clients')).toBeNull();
  });

  it('refetches a cached review count instead of showing it', async () => {
    auth.canRelease = true;
    auth.labRole = 'REVIEWER';
    // Cached a moment ago, before the last amendment was approved elsewhere
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 2 * 60 * 1000 } },
    });
    queryClient.setQueryData(['orders-review-count'], { count: 1 });

    renderAt('/orders', queryClient);

    expect((await screen.findAllByText('4')).length).toBeGreaterThan(0);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('an admin gets the setup tabs and pages', () => {
    Object.assign(auth, { isAdmin: true, canRelease: true, labRole: 'ADMIN' });
    renderAt('/clients');

    expect(screen.getByText('clients page')).toBeTruthy();
    for (const label of ADMIN_TABS) {
      expect(tab(label)).toBeTruthy();
    }
  });

  it('has the notification bell (rendered for every role)', () => {
    renderAt('/orders');

    expect(
      screen.getAllByRole('button', { name: 'notifications.bell' }).length
    ).toBeGreaterThan(0);
  });
});
