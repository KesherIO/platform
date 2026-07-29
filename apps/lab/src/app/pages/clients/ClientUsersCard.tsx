import { useTranslation } from 'react-i18next';
import type { ClientUser } from '../../types/lab.types';

interface Props {
  users: ClientUser[];
}

export function ClientUsersCard({ users }: Props) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">
        {t('clients.detail.users_title')} ({users.length})
      </h2>
      {users.length === 0 ? (
        <p className="text-sm text-gray-500">{t('clients.detail.no_users')}</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const displayName =
              [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
            return (
              <div
                key={u.userId}
                className="flex items-center gap-3 rounded-lg border border-gray-800 px-3 py-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-xs font-semibold text-white">
                  {(u.firstName?.[0] ?? u.email[0]).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-white">{displayName}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
                <span className="rounded-full bg-purple/20 px-2.5 py-0.5 text-xs font-medium text-purple">
                  {u.role}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
