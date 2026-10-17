import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { labApi } from '../api/labApi';
import type { LabNotification } from '../../types/lab.types';

const POLL_MS = 60_000;

/**
 * The signed-in member's own notifications in this lab: unread badge (polled,
 * and refreshed on window focus) and a panel to read and open them.
 */
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => labApi.notifications.unreadCount(),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
  const unreadCount = unread?.count ?? 0;

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => labApi.notifications.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
    staleTime: 0,
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
  };

  const openNotification = async (n: LabNotification) => {
    setOpen(false);
    if (!n.readAt) {
      await labApi.notifications.markRead(n.id).catch(() => undefined);
      refresh();
    }
    navigate(n.link);
  };

  const markAllRead = async () => {
    await labApi.notifications.markAllRead().catch(() => undefined);
    refresh();
  };

  const describe = (n: LabNotification) =>
    t(`notifications.types.${n.type}`, {
      req: n.params.requisitionNumber ?? '',
    });

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? t('notifications.bell_unread', { count: unreadCount })
            : t('notifications.bell')
        }
        aria-expanded={open}
        className="relative rounded-lg p-2 text-gray-300 transition hover:bg-gray-800 hover:text-white"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-cyan px-1 text-center text-[10px] font-semibold leading-5 text-gray-950">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="fixed inset-x-2 top-14 z-50 max-h-[70vh] overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-2xl md:absolute md:inset-x-auto md:left-0 md:top-11 md:w-96"
        >
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">
              {t('notifications.title')}
            </h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-cyan hover:underline"
              >
                {t('notifications.mark_all_read')}
              </button>
            )}
          </div>

          <div className="max-h-[calc(70vh-3rem)] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">…</p>
            ) : error ? (
              <p className="px-4 py-6 text-center text-sm text-red-400">
                {t('notifications.load_error')}
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                {t('notifications.empty')}
              </p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className="flex w-full gap-3 px-4 py-3 text-left transition hover:bg-gray-800"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.readAt ? 'bg-transparent' : 'bg-cyan'
                        }`}
                        aria-label={
                          n.readAt ? undefined : t('notifications.unread')
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${
                            n.readAt
                              ? 'text-gray-400'
                              : 'font-medium text-white'
                          }`}
                        >
                          {describe(n)}
                        </span>
                        {n.patientName && (
                          <span className="block truncate text-xs text-gray-500">
                            {n.patientName}
                          </span>
                        )}
                        <span className="block text-xs text-gray-500">
                          {new Date(n.createdAt).toLocaleString(i18n.language, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasNextPage && (
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full border-t border-gray-800 px-4 py-2 text-xs text-gray-400 hover:text-white disabled:opacity-50"
              >
                {t('notifications.load_more')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
