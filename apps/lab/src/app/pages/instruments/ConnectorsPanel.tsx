import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, ShieldOff } from 'lucide-react';
import { apiErrorMessage, labApi } from '../../shared/api/labApi';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** Admin: per-analyzer connector credentials. A token is shown once, at creation. */
export function ConnectorsPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [analyzerId, setAnalyzerId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  const { data: analyzers = [] } = useQuery({ queryKey: ['analyzers'], queryFn: () => labApi.analyzers.list() });
  const { data: credentials = [], isLoading } = useQuery({ queryKey: ['connector-credentials'], queryFn: () => labApi.instruments.credentials.list() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['connector-credentials'] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await labApi.instruments.credentials.create(analyzerId, name.trim());
      setIssued({ name: r.name, token: r.token });
      setName('');
      invalidate();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, label: string) => {
    const ok = await confirm({
      title: t('instruments.connectors.revoke_title', { name: label }),
      message: t('instruments.connectors.revoke_message'),
      confirmLabel: t('instruments.connectors.revoke'),
      variant: 'destructive',
      icon: ShieldOff,
      onConfirm: () => labApi.instruments.credentials.revoke(id),
    });
    if (ok) invalidate();
  };

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
        <label className="text-sm text-gray-300">
          {t('instruments.col.analyzer')}
          <select required value={analyzerId} onChange={(e) => setAnalyzerId(e.target.value)} className="mt-1 block rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white">
            <option value="" disabled>{t('instruments.connectors.pick_analyzer')}</option>
            {analyzers.filter((a) => a.isActive).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-300">
          {t('instruments.connectors.name')}
          <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('instruments.connectors.name_placeholder')} className="mt-1 block rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-white" />
        </label>
        <button disabled={busy || !analyzerId} className="flex items-center gap-2 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50">
          <KeyRound size={16} /> {t('instruments.connectors.create')}
        </button>
      </form>

      {issued && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-200">{t('instruments.connectors.token_once', { name: issued.name })}</p>
          <code className="mt-2 block break-all rounded bg-gray-950 p-3 text-xs text-white">{issued.token}</code>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={() => navigator.clipboard.writeText(issued.token).then(() => toast.success(t('instruments.connectors.copied')))} className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800">
              <Copy size={14} /> {t('instruments.connectors.copy')}
            </button>
            <button type="button" onClick={() => setIssued(null)} className="text-sm text-gray-400 hover:text-white">{t('instruments.connectors.done')}</button>
          </div>
          <p className="mt-2 text-xs text-gray-400">{t('instruments.connectors.configure_hint')}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('instruments.connectors.name')}</th>
              <th className="px-4 py-2 font-medium">{t('instruments.col.analyzer')}</th>
              <th className="px-4 py-2 font-medium">{t('instruments.connectors.token')}</th>
              <th className="px-4 py-2 font-medium">{t('instruments.connectors.last_seen')}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">…</td></tr>}
            {credentials.map((c) => (
              <tr key={c.id} className="border-t border-gray-800">
                <td className="px-4 py-2 text-white">{c.name}</td>
                <td className="px-4 py-2 text-gray-300">{c.analyzer.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-400">kvc_{c.tokenPrefix}_…</td>
                <td className="px-4 py-2 text-gray-400">{fmt(c.lastSeenAt)}{c.lastSeenAddress ? ` · ${c.lastSeenAddress}` : ''}</td>
                <td className="px-4 py-2 text-right">
                  {c.revokedAt ? (
                    <span className="text-xs text-red-300">{t('instruments.connectors.revoked', { when: fmt(c.revokedAt) })}</span>
                  ) : (
                    <button onClick={() => revoke(c.id, c.name)} className="text-xs text-red-300 hover:underline">{t('instruments.connectors.revoke')}</button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && credentials.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">{t('instruments.connectors.none')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
