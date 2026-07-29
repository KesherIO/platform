import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { AddClientModal } from './AddClientModal';
import { ClientsListSkeleton } from './ClientSkeletons';
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

export function ClientsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [clients, setClients] = useState<ClientOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [showAddModal, setShowAddModal] = useState(false);

  const pageSize = 20;

  const loadClients = useCallback(
    (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      setFiltering(true);
      setError(null);
      labApi.clients
        .list({
          status: statusFilter,
          search: search || undefined,
          page,
          pageSize,
        })
        .then((res) => {
          setClients(res.data);
          setTotal(res.total);
          setTotalPages(res.totalPages);
        })
        .catch(() => setError(t('clients.error')))
        .finally(() => {
          setLoading(false);
          setFiltering(false);
        });
    },
    [statusFilter, search, page, t]
  );

  useEffect(() => {
    loadClients(clients.length === 0);
  }, [loadClients]);

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
          {!loading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {total} {t('clients.subtitle')}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            + {t('clients.add_client')}
          </button>
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
      {loading && clients.length === 0 && <ClientsListSkeleton />}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && clients.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {t('clients.empty')}
        </div>
      )}

      {/* Client list */}
      {!error && clients.length > 0 && (
        <div
          className={`transition-opacity ${
            filtering ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="space-y-2">
            {clients.map((client) => (
              <button
                key={client.id}
                onClick={() => navigate(`/clients/${client.id}`)}
                className="flex w-full items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 text-left transition hover:border-gray-700"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700 text-sm font-semibold text-white">
                    {client.name[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {client.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {client.primaryContactEmail}
                      {client.clientType && (
                        <span className="ml-2 text-gray-500">
                          · {t(`clients.type.${client.clientType}`)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-5">
                  <div className="text-right">
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

      {/* Add client modal */}
      {showAddModal && (
        <AddClientModal
          onClose={() => setShowAddModal(false)}
          onCreated={loadClients}
        />
      )}
    </div>
  );
}
