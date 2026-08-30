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
  Analyzer,
  LabTestConfiguration,
  GenerateTestConfigsResult,
  TemplateDefinition,
  TemplateVersion,
  ExpectedSpecimensResponse,
  Specimen,
  AccessionSpecimenInput,
  WorklistItem,
  WorklistQuery,
  WorklistCountsResponse,
  LabSigner,
  ReadinessResult,
  BulkReadinessResponse,
  ReleaseHistoryResponse,
  CurrentResultsResponse,
  AmendmentInfo,
  AmendmentAnalyteInfo,
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

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: 'PUT',
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
    importPlatform: () =>
      post<{
        created: number;
        updated: number;
        disabled: number;
        total: number;
      }>('lab/catalog/import-platform'),
    importCatalog: (data: {
      items: import('../../types/lab.types').ImportCatalogItemInput[];
      replace?: boolean;
    }) =>
      post<{ created: number; updated: number }>('lab/catalog/import', data),
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
  analyzers: {
    list: () => get<Analyzer[]>('lab-config/analyzers'),
    create: (data: Record<string, unknown>) =>
      post<Analyzer>('lab-config/analyzers', data),
    update: (id: string, data: Record<string, unknown>) =>
      patch<Analyzer>(`lab-config/analyzers/${id}`, data),
    enable: (id: string) => post<Analyzer>(`lab-config/analyzers/${id}/enable`),
    disable: (id: string) =>
      post<Analyzer>(`lab-config/analyzers/${id}/disable`),
  },
  testConfigs: {
    list: () => get<LabTestConfiguration[]>('lab-config/test-configs'),
    upsert: (data: Record<string, unknown>) =>
      post<LabTestConfiguration>('lab-config/test-configs', data),
    remove: (id: string) => del(`lab-config/test-configs/${id}`),
    generate: () =>
      post<GenerateTestConfigsResult>('lab-config/test-configs/generate'),
  },
  specimens: {
    getExpected: (orderId: string) =>
      get<ExpectedSpecimensResponse>(
        `lab/orders/${orderId}/expected-specimens`
      ),
    accessionOrder: (orderId: string, specimens: AccessionSpecimenInput[]) =>
      post<{ specimens: Specimen[]; order: { id: string; status: string } }>(
        `lab/orders/${orderId}/accession`,
        { specimens }
      ),
    update: (specimenId: string, data: Record<string, unknown>) =>
      patch<Specimen>(`lab/specimens/${specimenId}`, data),
    markMissing: (orderId: string, specimenId: string, reason: string) =>
      post<Specimen>(
        `lab/orders/${orderId}/specimens/${specimenId}/mark-missing`,
        { reason, confirm: true }
      ),
    reverseMissing: (orderId: string, specimenId: string, reason?: string) =>
      post<Specimen>(
        `lab/orders/${orderId}/specimens/${specimenId}/reverse-missing`,
        { reason, confirm: true }
      ),
    resolveTemplate: (orderedTestId: string) =>
      post<{ resolved: boolean; test: { id: string; status: string } }>(
        `lab/ordered-tests/${orderedTestId}/resolve-template`
      ),
    assignTemplate: (orderedTestId: string, templateVersionId: string) =>
      post<{ resolved: boolean; test: { id: string; status: string } }>(
        `lab/ordered-tests/${orderedTestId}/assign-template`,
        { templateVersionId }
      ),
  },
  resultEntry: {
    getSession: (testId: string) =>
      get<{
        test: { id: string; name: string; code: string | null; status: string };
        template: { title: string; defaultObservations: string | null; observationPhrases: string[] | null };
        report: {
          id: string;
          observations: string | null;
          correctionNotes?: string | null;
        } | null;
        sections: Array<{
          id: string | null;
          name: string | null;
          analytes: Array<{
            id: string;
            code: string;
            name: string;
            technique: string | null;
            valueType: string;
            unit: string | null;
            options: string[];
            referenceRange: {
              min?: number;
              max?: number;
              displayText: string;
            } | null;
            isHeader: boolean;
            formula: string | null;
            sortOrder: number;
            savedValueId: string | null;
            numericValue: number | null;
            textValue: string | null;
            booleanValue: boolean | null;
            selectValue: string | null;
          }>;
        }>;
      }>(`lab/ordered-tests/${testId}/result-session`),
    saveAnalytes: (
      testId: string,
      analytes: Array<{
        templateAnalyteId: string;
        numericValue?: number | null;
        textValue?: string | null;
        booleanValue?: boolean | null;
        selectValue?: string | null;
      }>,
      observations?: string | null
    ) =>
      patch<{ reportId: string; saved: number }>(
        `lab/ordered-tests/${testId}/analytes`,
        { analytes, observations }
      ),
    submit: (testId: string) =>
      post<{ status: string }>(`lab/ordered-tests/${testId}/submit-results`),
    releaseReport: (reportId: string) =>
      post<{ id: string; status: string }>(`lab/reports/${reportId}/release`),
  },
  reports: {
    getById: (reportId: string) => get<unknown>(`lab/reports/${reportId}`),
    getByOrderId: (orderId: string) =>
      get<unknown>(`lab/reports/by-order/${orderId}`),
  },
  review: {
    submitForReview: (orderId: string, testIds?: string[]) =>
      post<{ status: string; reportId: string }>(
        `lab/orders/${orderId}/submit-for-review`,
        testIds ? { testIds } : {}
      ),
    approveAndRelease: (
      orderId: string,
      data: {
        signerId: string;
        testIds: string[];
        reviewNotes?: string;
        observations?: string;
      }
    ) =>
      post<{
        releaseId: string;
        releaseSequence: number;
        releaseType: string;
        aggregateReportStatus: string;
      }>(`lab/orders/${orderId}/approve-release`, data),
    requestCorrections: (
      orderId: string,
      correctionNotes: string,
      testIds?: string[]
    ) =>
      post<{ status: string; correctionNotes: string }>(
        `lab/orders/${orderId}/request-corrections`,
        { correctionNotes, testIds }
      ),
    getReviewerSigners: () => get<LabSigner[]>('lab/signers/reviewers'),
  },
  release: {
    getHistory: (orderId: string) =>
      get<ReleaseHistoryResponse>(`lab/orders/${orderId}/releases`),
    getCurrentResults: (orderId: string) =>
      get<CurrentResultsResponse>(`lab/orders/${orderId}/current-results`),
  },
  amendment: {
    initiate: (
      orderId: string,
      data: { reportTestId: string; reason: string }
    ) =>
      post<{
        amendmentId: string;
        status: string;
        analytes: AmendmentAnalyteInfo[];
      }>(`lab/orders/${orderId}/amendments`, data),
    get: (orderId: string, amendmentId: string) =>
      get<{ amendment: AmendmentInfo; sourceAnalytes: AmendmentAnalyteInfo[] }>(
        `lab/orders/${orderId}/amendments/${amendmentId}`
      ),
    editAnalytes: (
      orderId: string,
      amendmentId: string,
      analytes: Array<{
        id: string;
        numericValue?: number | null;
        textValue?: string | null;
        booleanValue?: boolean | null;
        selectValue?: string | null;
      }>
    ) =>
      put<{ updated: number }>(
        `lab/orders/${orderId}/amendments/${amendmentId}/analytes`,
        { analytes }
      ),
    submitForReview: (orderId: string, amendmentId: string) =>
      post<{ status: string }>(
        `lab/orders/${orderId}/amendments/${amendmentId}/submit`
      ),
    approve: (
      orderId: string,
      amendmentId: string,
      data: { signerId: string; reviewNotes?: string; observations?: string }
    ) =>
      post<unknown>(
        `lab/orders/${orderId}/amendments/${amendmentId}/approve`,
        data
      ),
    cancel: (orderId: string, amendmentId: string) =>
      post<{ status: string }>(
        `lab/orders/${orderId}/amendments/${amendmentId}/cancel`
      ),
  },
  worklist: {
    list: (params?: WorklistQuery) => {
      const sp = new URLSearchParams();
      if (params?.department) sp.set('department', params.department);
      if (params?.status) sp.set('status', params.status);
      if (params?.assignmentFilter)
        sp.set('assignmentFilter', params.assignmentFilter);
      if (params?.search) sp.set('search', params.search);
      if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
      if (params?.dateTo) sp.set('dateTo', params.dateTo);
      if (params?.page) sp.set('page', String(params.page));
      if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
      const qs = sp.toString();
      return get<PaginatedResponse<WorklistItem>>(
        `lab/worklist${qs ? `?${qs}` : ''}`
      );
    },
    counts: () => get<WorklistCountsResponse>('lab/worklist/counts'),
    readyCount: () => get<{ count: number }>('lab/worklist/ready-count'),
    claim: (testId: string, version: number) =>
      post<WorklistItem>(`lab/ordered-tests/${testId}/claim`, { version }),
    unclaim: (testId: string) =>
      post<WorklistItem>(`lab/ordered-tests/${testId}/unclaim`),
    start: (testId: string) =>
      post<WorklistItem>(`lab/ordered-tests/${testId}/start`),
    reassign: (testId: string, targetUserId: string, version: number) =>
      post<WorklistItem>(`lab/ordered-tests/${testId}/reassign`, {
        targetUserId,
        version,
      }),
  },
  templates: {
    list: (params?: { catalogItemCode?: string; species?: string }) => {
      const sp = new URLSearchParams();
      if (params?.catalogItemCode)
        sp.set('catalogItemCode', params.catalogItemCode);
      if (params?.species) sp.set('species', params.species);
      const qs = sp.toString();
      return get<TemplateDefinition[]>(`lab/templates${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) => get<TemplateDefinition>(`lab/templates/${id}`),
    create: (data: Record<string, unknown>) =>
      post<TemplateDefinition>('lab/templates', data),
    clone: (id: string) =>
      post<TemplateDefinition>(`lab/templates/${id}/clone`),
    createDraft: (id: string) =>
      post<TemplateVersion>(`lab/templates/${id}/draft`),
    updateDraft: (versionId: string, data: Record<string, unknown>) =>
      patch<TemplateVersion>(`lab/template-versions/${versionId}`, data),
    publish: (versionId: string) =>
      post<TemplateVersion>(`lab/template-versions/${versionId}/publish`),
    archive: (versionId: string) =>
      post<TemplateVersion>(`lab/template-versions/${versionId}/archive`),
    delete: (id: string) => del(`lab/templates/${id}`),
  },

  readiness: {
    single: (catalogItemId: string) =>
      get<ReadinessResult>(`lab/catalog/${catalogItemId}/readiness`),
    bulk: () => get<BulkReadinessResponse>('lab/catalog/readiness'),
  },
};
