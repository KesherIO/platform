import { supabase } from '../../auth/supabase';
import type {
  LabOrderSummary,
  PaginatedResponse,
  LabOrdersQuery,
  ClientOrganization,
  ClientDetail,
  ClientsQuery,
  CreateClientResponse,
  CatalogItem,
  CatalogQuery,
  CatalogListResponse,
  PickupSummary,
  CollectionsQuery,
  MessengerInfo,
  TimelineEvent,
} from '../../types/lab.types';

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function del(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`/api/${path}`, {
    method: 'DELETE',
    headers: await authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export const labApi = {
  orders: {
    list: (params?: LabOrdersQuery) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      if (params?.search) sp.set('search', params.search);
      if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
      if (params?.dateTo) sp.set('dateTo', params.dateTo);
      if (params?.page) sp.set('page', String(params.page));
      if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
      const qs = sp.toString();
      return get<PaginatedResponse<LabOrderSummary>>(
        `lab/orders${qs ? `?${qs}` : ''}`
      );
    },
    getById: (id: string) => get<unknown>(`lab/orders/${id}`),
    updateStatus: (id: string, status: string) =>
      patch<unknown>(`lab/orders/${id}/status`, { status }),
    receiveAll: (id: string) => post<unknown[]>(`lab/orders/${id}/receive-all`),
    initOrderedTests: (id: string) =>
      post<unknown[]>(`lab/orders/${id}/ordered-tests`),
  },
  orderedTests: {
    update: (testId: string, data: Record<string, unknown>) =>
      patch<unknown>(`lab/ordered-tests/${testId}`, data),
    receive: (testId: string) =>
      patch<unknown>(`lab/ordered-tests/${testId}/receive`, {}),
  },
  settings: {
    getProfile: () => get<unknown>('lab/settings/laboratory'),
    updateProfile: (data: Record<string, unknown>) =>
      patch<unknown>('lab/settings/laboratory', data),
    getContactInfo: () => get<unknown>('lab/settings/contact'),
    updateContactInfo: (data: Record<string, unknown>) =>
      patch<unknown>('lab/settings/contact', data),
  },
  users: {
    list: () => get<unknown[]>('lab/users'),
    create: (data: Record<string, unknown>) => post<unknown>('lab/users', data),
    updateRole: (userId: string, role: string) =>
      patch<unknown>(`lab/users/${userId}/role`, { role }),
    update: (userId: string, data: Record<string, unknown>) =>
      patch<unknown>(`lab/users/${userId}`, data),
    remove: (userId: string) => del(`lab/users/${userId}`),
  },
  clients: {
    list: (params?: ClientsQuery) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      if (params?.search) sp.set('search', params.search);
      if (params?.page) sp.set('page', String(params.page));
      if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
      const qs = sp.toString();
      return get<PaginatedResponse<ClientOrganization>>(
        `lab/clients${qs ? `?${qs}` : ''}`
      );
    },
    getById: (id: string) => get<ClientDetail>(`lab/clients/${id}`),
    create: (data: Record<string, unknown>) =>
      post<CreateClientResponse>('lab/clients', data),
    update: (id: string, data: Record<string, unknown>) =>
      patch<unknown>(`lab/clients/${id}`, data),
    updateCollectionSettings: (id: string, data: Record<string, unknown>) =>
      patch<unknown>(`lab/clients/${id}/collection-settings`, data),
    suspend: (id: string) => post<unknown>(`lab/clients/${id}/suspend`),
    reactivate: (id: string) => post<unknown>(`lab/clients/${id}/reactivate`),
    regenerateInvitation: (id: string) =>
      post<CreateClientResponse>(`lab/clients/${id}/invitation/regenerate`),
    revokeInvitation: (id: string) =>
      post<unknown>(`lab/clients/${id}/invitation/revoke`),
    remove: (id: string) => del(`lab/clients/${id}`),
  },
  catalog: {
    list: (params?: CatalogQuery) => {
      const sp = new URLSearchParams();
      if (params?.search) sp.set('search', params.search);
      if (params?.kind) sp.set('kind', params.kind);
      if (params?.page) sp.set('page', String(params.page));
      if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
      const qs = sp.toString();
      return get<CatalogListResponse>(`catalog/admin${qs ? `?${qs}` : ''}`);
    },
    // All active items in this lab's own catalog, unpaginated — used by the
    // PACKAGE component picker (filter to kind === 'TEST' client-side).
    listActive: () =>
      get<PaginatedResponse<CatalogItem>>('catalog/admin?pageSize=200'),
    create: (data: Record<string, unknown>) =>
      post<CatalogItem>('catalog', data),
    update: (id: string, data: Record<string, unknown>) =>
      patch<CatalogItem>(`catalog/${id}`, data),
    enable: (id: string) => post<CatalogItem>(`catalog/${id}/enable`),
    disable: (id: string) => post<CatalogItem>(`catalog/${id}/disable`),
  },
  pickups: {
    list: (params?: CollectionsQuery) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      if (params?.search) sp.set('search', params.search);
      if (params?.messengerId) sp.set('messengerId', params.messengerId);
      if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
      if (params?.dateTo) sp.set('dateTo', params.dateTo);
      if (params?.page) sp.set('page', String(params.page));
      if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
      const qs = sp.toString();
      return get<PaginatedResponse<PickupSummary>>(
        `lab/pickups${qs ? `?${qs}` : ''}`
      );
    },
    getById: (id: string) => get<PickupSummary>(`lab/pickups/${id}`),
    unassignedCount: () =>
      get<{ count: number }>('lab/pickups/unassigned-count'),
    assign: (id: string, messengerId: string) =>
      post<PickupSummary>(`lab/pickups/${id}/assign`, { messengerId }),
    received: (id: string) => post<PickupSummary>(`lab/pickups/${id}/received`),
    cancel: (id: string, reason?: string) =>
      post<PickupSummary>(`lab/pickups/${id}/cancel`, { reason }),
    myPickups: (params?: { status?: string }) => {
      const sp = new URLSearchParams();
      if (params?.status) sp.set('status', params.status);
      const qs = sp.toString();
      return get<PickupSummary[]>(`lab/my-pickups${qs ? `?${qs}` : ''}`);
    },
    accept: (id: string) => post<PickupSummary>(`lab/pickups/${id}/accept`),
    collected: (id: string) =>
      post<PickupSummary>(`lab/pickups/${id}/collected`),
    reportProblem: (id: string, reason: string, details?: string) =>
      post<{ reported: boolean }>(`lab/pickups/${id}/problem`, {
        reason,
        details,
      }),
  },
  messengers: {
    list: () => get<MessengerInfo[]>('lab/messengers'),
    savePushSubscription: (subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }) =>
      post<{ saved: boolean }>(
        'lab/messengers/me/push-subscription',
        subscription
      ),
    removePushSubscription: (endpoint: string) =>
      del('lab/messengers/me/push-subscription', { endpoint }),
  },
  timeline: {
    forOrder: (orderId: string) =>
      get<TimelineEvent[]>(`lab/orders/${orderId}/timeline`),
  },
};
