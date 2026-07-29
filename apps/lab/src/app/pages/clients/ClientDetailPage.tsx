import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { ClientDetailSkeleton } from './ClientSkeletons';
import { ClientInfoCard } from './ClientInfoCard';
import { ClientInvitationCard } from './ClientInvitationCard';
import { ClientUsersCard } from './ClientUsersCard';
import { ClientOrdersCard } from './ClientOrdersCard';
import type {
  ClientDetail,
  ClientStatus,
  CreateClientResponse,
} from '../../types/lab.types';

const STATUS_COLORS: Record<ClientStatus, string> = {
  PENDING: 'bg-yellow-900/30 text-yellow-300',
  ACTIVE: 'bg-green-900/30 text-green-300',
  SUSPENDED: 'bg-red-900/30 text-red-300',
};

export function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, tenantName } = useAuth();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<CreateClientResponse | null>(null);

  const loadClient = (showSpinner = true) => {
    if (!id) return;
    if (showSpinner) setLoading(true);
    setError(null);
    labApi.clients
      .getById(id)
      .then((data) => setClient(data))
      .catch(() => setError(t('clients.errors.load_detail')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadClient();
  }, [id]);

  const handleSuspend = async () => {
    if (!client || !id) return;
    if (!confirm(t('clients.detail.confirm_suspend', { name: client.name })))
      return;
    try {
      setActionError(null);
      await labApi.clients.suspend(id);
      loadClient(false);
    } catch (err) {
      setActionError(
        `${t('clients.errors.suspend')} ${(err as Error).message}`
      );
    }
  };

  const handleReactivate = async () => {
    if (!id) return;
    try {
      setActionError(null);
      await labApi.clients.reactivate(id);
      loadClient(false);
    } catch (err) {
      setActionError(
        `${t('clients.errors.reactivate')} ${(err as Error).message}`
      );
    }
  };

  const handleRegenerate = async () => {
    if (!id) return;
    if (!confirm(t('clients.invitation.confirm_regenerate'))) return;
    try {
      setActionError(null);
      const res = await labApi.clients.regenerateInvitation(id);
      setNewLink(res);
      loadClient(false);
    } catch (err) {
      setActionError(
        `${t('clients.errors.regenerate')} ${(err as Error).message}`
      );
    }
  };

  const handleRevoke = async () => {
    if (!id) return;
    if (!confirm(t('clients.invitation.confirm_revoke'))) return;
    try {
      setActionError(null);
      setNewLink(null);
      await labApi.clients.revokeInvitation(id);
      loadClient(false);
    } catch (err) {
      setActionError(`${t('clients.errors.revoke')} ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!client || !id) return;
    if (!confirm(t('clients.detail.confirm_delete', { name: client.name })))
      return;
    try {
      setActionError(null);
      await labApi.clients.remove(id);
      navigate('/clients');
    } catch (err) {
      setActionError(`${t('clients.errors.delete')} ${(err as Error).message}`);
    }
  };

  if (loading) {
    return <ClientDetailSkeleton />;
  }

  if (error || !client) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/clients')}
          className="mb-4 text-sm text-gray-400 hover:text-white"
        >
          {t('clients.detail.back')}
        </button>
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error ?? t('clients.errors.load_detail')}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <button
        onClick={() => navigate('/clients')}
        className="mb-4 text-sm text-gray-400 hover:text-white"
      >
        {t('clients.detail.back')}
      </button>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-700 text-lg font-bold text-white">
            {client.name[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{client.name}</h1>
            <p className="text-sm text-gray-400">
              {client.clientType && t(`clients.type.${client.clientType}`)}
              <span
                className={`ml-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  STATUS_COLORS[client.status]
                }`}
              >
                {t(`clients.status.${client.status}`)}
              </span>
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            {client.status === 'SUSPENDED' ? (
              <button
                onClick={handleReactivate}
                className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
              >
                {t('clients.detail.reactivate')}
              </button>
            ) : (
              <button
                onClick={handleSuspend}
                className="rounded-lg border border-red-900/50 px-4 py-2 text-sm text-red-400 hover:bg-red-900/20"
              >
                {t('clients.detail.suspend')}
              </button>
            )}
            {client.orderCount === 0 && (
              <button
                onClick={handleDelete}
                className="rounded-lg border border-red-900/50 px-4 py-2 text-sm text-red-400 hover:bg-red-900/20"
              >
                {t('clients.detail.delete')}
              </button>
            )}
          </div>
        )}
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ClientInfoCard
          client={client}
          isAdmin={isAdmin}
          onUpdated={() => loadClient(false)}
          onError={setActionError}
        />

        {client.status !== 'ACTIVE' && (
          <ClientInvitationCard
            invitation={client.invitation}
            isAdmin={isAdmin}
            labName={tenantName ?? 'KesherIO'}
            newLink={newLink}
            onRegenerate={handleRegenerate}
            onRevoke={handleRevoke}
          />
        )}

        <ClientUsersCard users={client.users} />

        <ClientOrdersCard orders={client.recentOrders} />
      </div>
    </div>
  );
}
