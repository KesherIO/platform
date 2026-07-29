import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClientInvitation,
  CreateClientResponse,
} from '../../types/lab.types';

interface Props {
  invitation: ClientInvitation | null;
  isAdmin: boolean;
  labName: string;
  newLink: CreateClientResponse | null;
  onRegenerate: () => void;
  onRevoke: () => void;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ClientInvitationCard({
  invitation: inv,
  isAdmin,
  labName,
  newLink,
  onRegenerate,
  onRevoke,
}: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);

  const copyToClipboard = async (text: string, type: 'link' | 'message') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const invIsActive =
    inv && !inv.used && !inv.revokedAt && new Date(inv.expiresAt) > new Date();
  const invIsExpired =
    inv && !inv.used && !inv.revokedAt && new Date(inv.expiresAt) <= new Date();

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">
        {t('clients.invitation.title')}
      </h2>

      {newLink && (
        <div className="mb-4 space-y-3">
          <div className="rounded-lg bg-green-900/20 px-3 py-2 text-sm text-green-300">
            {t('clients.invitation.generated')}
          </div>
          <div className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
            <p className="break-all text-xs text-cyan">
              {newLink.onboardingLink}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copyToClipboard(newLink.onboardingLink, 'link')}
              className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-semibold text-gray-950 hover:opacity-90"
            >
              {copied === 'link'
                ? t('clients.invitation.copied')
                : t('clients.invitation.copy_link')}
            </button>
            <button
              onClick={() =>
                copyToClipboard(
                  t('clients.invitation.message_template', {
                    labName,
                    link: newLink.onboardingLink,
                  }),
                  'message'
                )
              }
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
            >
              {copied === 'message'
                ? t('clients.invitation.copied')
                : t('clients.invitation.copy_message')}
            </button>
          </div>
        </div>
      )}

      {inv ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                inv.used
                  ? 'bg-green-900/30 text-green-300'
                  : inv.revokedAt
                  ? 'bg-red-900/30 text-red-300'
                  : invIsExpired
                  ? 'bg-gray-700 text-gray-400'
                  : 'bg-cyan/20 text-cyan'
              }`}
            >
              {inv.used
                ? t('clients.invitation.status_accepted')
                : inv.revokedAt
                ? t('clients.invitation.status_revoked')
                : invIsExpired
                ? t('clients.invitation.status_expired')
                : t('clients.invitation.status_active')}
            </span>
          </div>

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-500">{t('settings.email')}</dt>
              <dd className="text-white">{inv.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">
                {t('clients.invitation.expires')}
              </dt>
              <dd className="text-white">{formatDateTime(inv.expiresAt)}</dd>
            </div>
            {inv.acceptedAt && (
              <div>
                <dt className="text-xs text-gray-500">
                  {t('clients.invitation.status_accepted')}
                </dt>
                <dd className="text-white">{formatDateTime(inv.acceptedAt)}</dd>
              </div>
            )}
          </dl>

          {isAdmin && !inv.used && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={onRegenerate}
                className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-semibold text-gray-950 hover:opacity-90"
              >
                {t('clients.invitation.regenerate')}
              </button>
              {invIsActive && (
                <button
                  onClick={onRevoke}
                  className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
                >
                  {t('clients.invitation.revoke')}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            {t('clients.invitation.no_invitation')}
          </p>
          {isAdmin && (
            <button
              onClick={onRegenerate}
              className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-semibold text-gray-950 hover:opacity-90"
            >
              {t('clients.invitation.regenerate')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
