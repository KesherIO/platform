import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ban, Trash2, XCircle, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { ClientDetailSkeleton } from './ClientSkeletons';
import { ClientInfoCard } from './ClientInfoCard';
import { ClientInvitationCard } from './ClientInvitationCard';
import { ClientUsersCard } from './ClientUsersCard';
import { ClientOrdersCard } from './ClientOrdersCard';
import { ClientCollectionSettingsCard } from './ClientCollectionSettingsCard';
import type { ClientStatus, CreateClientResponse } from '../../types/lab.types';

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
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const {
    data: client,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['client', id],
    queryFn: () => labApi.clients.getById(id!),
    enabled: !!id,
  });

  const error = queryError ? t('clients.errors.load_detail') : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<CreateClientResponse | null>(null);

  const invalidateClient = () =>
    queryClient.invalidateQueries({ queryKey: ['client', id] });

  const handleSuspend = async () => {
    if (!client || !id) return;
    try {
      setActionError(null);
      const confirmed = await confirm({
        title: t('clients.detail.confirm_suspend_title'),
        message: t('clients.detail.confirm_suspend', { name: client.name }),
        confirmLabel: t('clients.detail.suspend'),
        variant: 'destructive',
        icon: Ban,
        onConfirm: () => labApi.clients.suspend(id),
      });
      if (!confirmed) return;
      invalidateClient();
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
      invalidateClient();
    } catch (err) {
      setActionError(
        `${t('clients.errors.reactivate')} ${(err as Error).message}`
      );
    }
  };

  const handleRegenerate = async () => {
    if (!id) return;
    try {
      setActionError(null);
      let response: CreateClientResponse | undefined;
      const confirmed = await confirm({
        title: t('clients.invitation.confirm_regenerate_title'),
        message: t('clients.invitation.confirm_regenerate'),
        confirmLabel: t('clients.invitation.regenerate'),
        variant: 'warning',
        icon: RefreshCw,
        onConfirm: async () => {
          response = await labApi.clients.regenerateInvitation(id);
        },
      });
      if (!confirmed) return;
      if (response) setNewLink(response);
      invalidateClient();
    } catch (err) {
      setActionError(
        `${t('clients.errors.regenerate')} ${(err as Error).message}`
      );
    }
  };

  const handleRevoke = async () => {
    if (!id) return;
    try {
      setActionError(null);
      const confirmed = await confirm({
        title: t('clients.invitation.confirm_revoke_title'),
        message: t('clients.invitation.confirm_revoke'),
        confirmLabel: t('clients.invitation.revoke'),
        variant: 'destructive',
        icon: XCircle,
        onConfirm: async () => {
          setNewLink(null);
          await labApi.clients.revokeInvitation(id);
        },
      });
      if (!confirmed) return;
      invalidateClient();
    } catch (err) {
      setActionError(`${t('clients.errors.revoke')} ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!client || !id) return;
    try {
      setActionError(null);
      const confirmed = await confirm({
        title: t('clients.detail.confirm_delete_title'),
        message: t('clients.detail.confirm_delete', { name: client.name }),
        confirmLabel: t('clients.detail.delete'),
        variant: 'destructive',
        icon: Trash2,
        onConfirm: () => labApi.clients.remove(id),
      });
      if (!confirmed) return;
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
          onUpdated={() => invalidateClient()}
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

        <ClientCollectionSettingsCard
          client={client}
          isAdmin={isAdmin}
          onUpdated={() => invalidateClient()}
          onError={setActionError}
        />
      </div>
    </div>
  );
}
