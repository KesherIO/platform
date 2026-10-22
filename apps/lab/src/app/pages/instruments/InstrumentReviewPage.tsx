import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { labApi, apiErrorMessage } from '../../shared/api/labApi';
import { useAuth } from '../../auth/AuthContext';
import { ConnectorsPanel } from './ConnectorsPanel';
import { InstrumentDetailPanel } from './InstrumentDetailPanel';
import { InstrumentFlagBadges } from './InstrumentFlagBadges';
import { reasonLabel, STATUS_STYLE } from './instrumentReasons';
import type { InstrumentQueueView } from '../../types/lab.types';

const TAB = 'flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan';
const TAB_ON = 'border-cyan/30 bg-cyan/10 text-cyan';
const TAB_OFF = 'border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white';

type Tab = InstrumentQueueView | 'connectors';

/** Analyzer results that need a person: unmatched, ambiguous, changed, expired reagent, interrupted. */
export function InstrumentReviewPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('review');
  const [selected, setSelected] = useState<string | null>(null);

  const view = tab === 'connectors' ? 'review' : tab;
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['instrument-messages', view],
    queryFn: ({ pageParam }) => labApi.instruments.list(view, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
    enabled: tab !== 'connectors',
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'review', label: t('instruments.tab.review') },
    { key: 'incomplete', label: t('instruments.tab.incomplete') },
    { key: 'all', label: t('instruments.tab.all') },
    ...(isAdmin ? [{ key: 'connectors' as Tab, label: t('instruments.tab.connectors') }] : []),
  ];

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <Activity size={20} className="text-cyan" />
        <h1 className="text-xl font-bold text-white">{t('instruments.title')}</h1>
      </div>
      <p className="mb-5 max-w-3xl text-sm text-gray-400">{t('instruments.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((x) => (
          <button key={x.key} onClick={() => setTab(x.key)} className={`${TAB} ${tab === x.key ? TAB_ON : TAB_OFF}`}>
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'connectors' ? (
        <ConnectorsPanel />
      ) : (
        <>
          {error && <p className="text-sm text-red-400">{apiErrorMessage(error)}</p>}
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('instruments.col.run')}</th>
                  <th className="px-4 py-2 font-medium">{t('instruments.col.analyzer')}</th>
                  <th className="px-4 py-2 font-medium">{t('instruments.col.sample')}</th>
                  <th className="px-4 py-2 font-medium">{t('instruments.col.status')}</th>
                  <th className="px-4 py-2 font-medium">{t('instruments.col.why')}</th>
                  <th className="px-4 py-2 font-medium">{t('instruments.col.order')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">…</td></tr>}
                {items.map((m) => (
                  <tr key={m.id} onClick={() => setSelected(m.id)} className={`cursor-pointer border-t border-gray-800 hover:bg-gray-900 ${selected === m.id ? 'bg-gray-900' : ''}`}>
                    <td className="px-4 py-2 text-gray-300">{new Date(m.observationTime ?? m.receivedAtConnector).toLocaleString()}</td>
                    <td className="px-4 py-2 text-gray-300">{m.analyzer.name}</td>
                    <td className="px-4 py-2 font-mono text-white">{m.sampleId ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status]}`}>{t(`instruments.status.${m.status}`, { defaultValue: m.status })}</span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        <InstrumentFlagBadges m={m} />
                        {m.reasons.filter((r) => r !== 'INCOMPLETE_TRANSFER').map((r) => (
                          <span key={r} className="text-xs text-gray-400">{reasonLabel(t, r)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-300">{m.order?.requisitionNumber ?? '—'}</td>
                  </tr>
                ))}
                {!isLoading && items.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">{t(tab === 'review' ? 'instruments.empty_review' : 'instruments.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hasNextPage && (
            <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="mt-3 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
              {t('instruments.load_more')}
            </button>
          )}
        </>
      )}

      {selected && <InstrumentDetailPanel id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
