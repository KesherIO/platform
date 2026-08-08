import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { labApi } from '../../shared/api/labApi';
import type { MessengerInfo } from '../../types/lab.types';

interface AssignMessengerModalProps {
  pickupId: string;
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignMessengerModal({
  pickupId,
  onClose,
  onAssigned,
}: AssignMessengerModalProps) {
  const { t } = useTranslation();
  const [messengers, setMessengers] = useState<MessengerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    labApi.messengers
      .list()
      .then(setMessengers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleAssign = async (messengerId: string) => {
    setAssigningId(messengerId);
    setError(null);
    try {
      await labApi.pickups.assign(pickupId, messengerId);
      onAssigned();
    } catch (err) {
      setError(`${t('collections.errors.assign')} ${(err as Error).message}`);
      setAssigningId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-white">
          {t('collections.assign_title')}
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          {t('collections.assign_subtitle')}
        </p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {loading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-gray-800"
              />
            ))}

          {!loading && messengers.length === 0 && (
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-6 text-center text-sm text-gray-500">
              {t('collections.no_messengers')}{' '}
              <Link
                to="/settings/users"
                className="text-cyan hover:underline"
                onClick={onClose}
              >
                {t('nav.team')}
              </Link>
            </div>
          )}

          {!loading &&
            messengers.map((m) => {
              const name =
                [m.firstName, m.lastName].filter(Boolean).join(' ') ||
                'Messenger';
              const isMessengerRole = m.role === 'MESSENGER';
              return (
                <button
                  key={m.userId}
                  onClick={() => handleAssign(m.userId)}
                  disabled={assigningId !== null}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-left transition hover:border-cyan/50 disabled:opacity-50"
                >
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-white">
                      {name}
                      {isMessengerRole ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            m.isCurrentlyScheduled
                              ? 'bg-emerald-900/30 text-emerald-300'
                              : 'bg-gray-800 text-gray-500'
                          }`}
                        >
                          {m.isCurrentlyScheduled
                            ? t('team.schedule.in_schedule')
                            : t('team.schedule.off_schedule')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                          {t(`team.roles.${m.role}`)}
                        </span>
                      )}
                    </p>
                    {m.phone && (
                      <p className="text-xs text-gray-500">{m.phone}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {assigningId === m.userId
                      ? t('collections.assigning')
                      : `${m.activePickupCount} ${t(
                          'collections.active_pickups'
                        )}`}
                  </span>
                </button>
              );
            })}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            disabled={assigningId !== null}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
