import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { AddClientModal } from './AddClientModal';
import { ImportClientsModal } from './ImportClientsModal';
import { ExportClientsModal } from './ExportClientsModal';
import { ClientsListSkeleton } from './ClientSkeletons';
import { formatPhoneDisplay } from '../../shared/phoneNumbers';
import type { ClientOrganization, ClientStatus } from '../../types/lab.types';

const STATUS_FILTERS: Array<{ key: string; value?: ClientStatus }> = [
  { key: 'all' },
  { key: 'pending', value: 'PENDING' },
  { key: 'active', value: 'ACTIVE' },
  { key: 'suspended', value: 'SUSPENDED' },
];

const STATUS_COLORS: Record<ClientStatus, string> = {
  PENDING: 'bg-yellow-900/30 text-yellow-300',
  ACTIVE: 'bg-green-900/30 text-green-300',
  SUSPENDED: 'bg-red-900/30 text-red-300',
};

/** Street address plus city, unless the address already names the city. */
function clientAddress(client: ClientOrganization): string {
  const address = client.address?.trim() ?? '';
  const city = client.city?.trim() ?? '';
  if (!city) return address;
  if (!address) return city;
  return address.toLowerCase().includes(city.toLowerCase())
    ? address
    : `${address}, ${city}`;
}

export function ClientsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const pageSize = 20;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['clients', { status: statusFilter, search, page }],
    queryFn: () =>
      labApi.clients.list({
        status: statusFilter,
        search: search || undefined,
        page,
        pageSize,
      }),
    staleTime: 0,
  });

  const clients = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  // Without filters the page total is every client; with filters, "Export
  // all" may still have rows, so the modal decides.
  const noClients = !isLoading && !statusFilter && !search && total === 0;

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('clients.title')}</h1>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {total} {t('clients.subtitle')}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800"
            >
              {t('clients.import_clients')}
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              disabled={noClients}
              title={noClients ? t('clients.export.no_clients') : undefined}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {t('clients.export_clients')}
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
            >
              + {t('clients.add_client')}
            </button>
          </div>
        )}
      </div>

      {/* Search + filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('clients.search_placeholder')}
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === f.value
                  ? 'bg-cyan/20 text-cyan'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {t(`clients.filter.${f.key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Loading — initial only */}
      {isLoading && <ClientsListSkeleton />}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {t('clients.error')}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && clients.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {t('clients.empty')}
        </div>
      )}

      {/* Client list */}
      {!error && clients.length > 0 && (
        <div
          className={`transition-opacity ${
            isFetching ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="space-y-2">
            {clients.map((client) => (
              <button
                key={client.id}
                onClick={() => navigate(`/clients/${client.id}`)}
                className="flex w-full flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 text-left transition hover:border-gray-700 sm:flex-row sm:items-start sm:justify-between sm:gap-5"
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-700 text-sm font-semibold text-white">
                    {client.name[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-3">
                      <p className="min-w-0 break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                        {client.name}
                      </p>
                      {client.clientType && (
                        <span className="shrink-0 rounded-md border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-[11px] text-gray-400">
                          {t(`clients.type.${client.clientType}`)}
                        </span>
                      )}
                    </div>
                    {clientAddress(client) && (
                      <p className="text-xs text-gray-400 [overflow-wrap:anywhere]">
                        {clientAddress(client)}
                      </p>
                    )}
                    {client.primaryContactEmail && (
                      <p className="text-xs text-gray-400 [overflow-wrap:anywhere]">
                        {client.primaryContactEmail}
                      </p>
                    )}
                    {client.phone?.trim() && (
                      <p className="text-xs text-gray-400 [overflow-wrap:anywhere]">
                        {t('clients.card.phone')}{' '}
                        {formatPhoneDisplay(client.phone, client.country)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-5 sm:justify-end">
                  <div className="sm:text-right">
                    <p className="text-xs text-gray-500">
                      {client.userCount}{' '}
                      {t('clients.columns.users').toLowerCase()} ·{' '}
                      {client.orderCount}{' '}
                      {t('clients.columns.orders').toLowerCase()}
                    </p>
                    <p className="text-xs text-gray-600">
                      {formatDate(client.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      STATUS_COLORS[client.status]
                    }`}
                  >
                    {t(`clients.status.${client.status}`)}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      )}

      {showImportModal && (
        <ImportClientsModal
          onClose={() => setShowImportModal(false)}
          onImported={() =>
            queryClient.invalidateQueries({ queryKey: ['clients'] })
          }
        />
      )}

      {showExportModal && (
        <ExportClientsModal
          status={statusFilter}
          search={search}
          filteredTotal={total}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Add client modal */}
      {showAddModal && (
        <AddClientModal
          onClose={() => setShowAddModal(false)}
          onCreated={() =>
            queryClient.invalidateQueries({ queryKey: ['clients'] })
          }
        />
      )}
    </div>
  );
}
