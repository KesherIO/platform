import { supabase } from '../../auth/supabase';

const getLabTenantId = () => localStorage.getItem('labTenantId') ?? '';

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'x-tenant-id': getLabTenantId(),
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

async function del(path: string): Promise<void> {
  const res = await fetch(`/api/${path}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export const labApi = {
  orders: {
    list: (status?: string) =>
      get<unknown[]>(`lab/orders${status ? `?status=${status}` : ''}`),
    getById: (id: string) => get<unknown>(`lab/orders/${id}`),
    updateStatus: (id: string, status: string) =>
      patch<unknown>(`lab/orders/${id}/status`, { status }),
    initOrderedTests: (id: string) =>
      post<unknown[]>(`lab/orders/${id}/ordered-tests`),
  },
  orderedTests: {
    update: (testId: string, data: Record<string, unknown>) =>
      patch<unknown>(`lab/ordered-tests/${testId}`, data),
  },
  settings: {
    getProfile: () => get<unknown>('lab/settings/laboratory'),
    updateProfile: (data: Record<string, unknown>) =>
      patch<unknown>('lab/settings/laboratory', data),
  },
  users: {
    list: () => get<unknown[]>('lab/users'),
    create: (data: Record<string, unknown>) => post<unknown>('lab/users', data),
    updateRole: (userId: string, role: string) =>
      patch<unknown>(`lab/users/${userId}/role`, { role }),
    remove: (userId: string) => del(`lab/users/${userId}`),
  },
};
