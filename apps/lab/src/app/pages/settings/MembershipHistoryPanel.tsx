import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import type { MembershipEvent } from '../../types/lab.types';

/**
 * Read-only membership audit log. With `userId` it shows one person's history
 * (works for removed members too); without it, the whole lab's.
 */
export function MembershipHistoryPanel({
  userId,
  title,
  onClose,
}: {
  userId?: string;
  title: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['membership-history', userId ?? 'all'],
    queryFn: ({ pageParam }) =>
      labApi.users.history({ userId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const events = data?.pages.flatMap((p) => p.items) ?? [];
  const role = (r: string | null) => (r ? t(`team.roles.${r}`) : '—');
  const signerRoles = (rs?: string[]) =>
    rs?.length
      ? rs.map((r) => t(`settings.role_${r.toLowerCase()}`)).join(', ')
      : '—';

  const describe = (e: MembershipEvent) => {
    switch (e.eventType) {
      case 'MEMBER_ADDED':
        return t('team.history.events.MEMBER_ADDED', { role: role(e.newRole) });
      case 'ROLE_CHANGED':
        return t('team.history.events.ROLE_CHANGED', {
          from: role(e.previousRole),
          to: role(e.newRole),
        });
      case 'PICKUP_CAPABILITY_CHANGED':
        return e.newCanPerformPickups
          ? t('team.history.events.PICKUP_GRANTED')
          : t('team.history.events.PICKUP_REVOKED');
      case 'IN_PROGRESS_ACCESS_CHANGED':
        return e.newCanViewInProgress
          ? t('team.history.events.IN_PROGRESS_GRANTED')
          : t('team.history.events.IN_PROGRESS_REVOKED');
      case 'REMOVED':
        return t('team.history.events.REMOVED', {
          role: role(e.previousRole),
        });
      case 'SIGNER_LINKED':
      case 'SIGNER_UNLINKED':
      case 'SIGNATURE_REPLACED':
        return t(`team.history.events.${e.eventType}`, {
          signer: e.details?.signerName ?? '—',
        });
      case 'SIGNER_ROLES_CHANGED':
        return t('team.history.events.SIGNER_ROLES_CHANGED', {
          signer: e.details?.signerName ?? '—',
          from: signerRoles(e.details?.previousRoles),
          to: signerRoles(e.details?.newRoles),
        });
      case 'EMAIL_CHANGED':
        return t('team.history.events.EMAIL_CHANGED', {
          from: e.details?.previousEmail ?? '—',
          to: e.details?.newEmail ?? '—',
        });
      case 'PROFILE_CHANGED':
        return t('team.history.events.PROFILE_CHANGED', {
          changes: Object.entries(e.details?.changes ?? {})
            .map(([field, c]) =>
              t('team.history.field_change', {
                field: t(`team.history.fields.${field}`),
                from: c?.from || '—',
                to: c?.to || '—',
              })
            )
            .join('; '),
        });
      default:
        return t(`team.history.events.${e.eventType}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="membership-history-title"
        className="flex h-full w-full max-w-md flex-col border-l border-gray-800 bg-gray-900 shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-gray-800 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="membership-history-title"
              className="truncate text-base font-semibold text-white"
            >
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {t('team.history.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.dismiss')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg bg-gray-800"
                />
              ))}
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">
              {t('team.history.error')}
            </p>
          )}

          {!isLoading && !error && events.length === 0 && (
            <p className="py-12 text-center text-sm text-gray-500">
              {t('team.history.empty')}
            </p>
          )}

          <ol className="space-y-3">
            {events.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3"
              >
                {!userId && (
                  <p className="truncate text-xs font-medium text-gray-400">
                    {e.targetName ?? e.targetEmail ?? e.targetUserId}
                  </p>
                )}
                <p className="text-sm text-white">{describe(e)}</p>
                {e.eventType === 'ROLE_CHANGED' &&
                  e.previousCanPerformPickups &&
                  !e.newCanPerformPickups && (
                    <p className="text-xs text-orange-300">
                      {t('team.history.events.PICKUP_REVOKED')}
                    </p>
                  )}
                {e.reason && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-300">
                    <span className="text-gray-500">
                      {t('team.history.reason')}:
                    </span>{' '}
                    {e.reason}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {e.actorUserId
                    ? t('team.history.by', {
                        name: e.actorName ?? t('team.history.unknown_user'),
                      })
                    : t('team.history.by_system')}
                  {' · '}
                  {new Date(e.createdAt).toLocaleString(i18n.language)}
                </p>
              </li>
            ))}
          </ol>

          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="mt-4 w-full rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {isFetchingNextPage
                ? t('common.loading')
                : t('team.history.more')}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
