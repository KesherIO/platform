import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, Hash } from 'lucide-react';
import { labApi } from '../../shared/api/labApi';
import { useToast } from '../../shared/components/ToastProvider';
import { reasonLabel } from '../instruments/instrumentReasons';
import type { OrderAnalyzerStatus } from '../../types/lab.types';

const STATE_STYLE: Record<
  OrderAnalyzerStatus['analyzers'][number]['state'],
  string
> = {
  IMPORTED: 'text-green-300',
  NEEDS_REVIEW: 'text-purple-300',
  WAITING: 'text-gray-400',
};

/** The number the technician types into every analyzer for this order, and what each analyzer sent. */
export function AnalyzerNumberPanel({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, isError } = useQuery({
    queryKey: ['order-analyzer-status', orderId],
    queryFn: () => labApi.instruments.orderStatus(orderId),
    refetchInterval: 30_000,
    retry: false,
  });
  // Roles without analyzer access get a 403: the order page simply has no panel for them
  if (isError || !data) return null;

  const copy = (n: string) =>
    navigator.clipboard
      .writeText(n)
      .then(() => toast.success(t('instruments.connectors.copied')));

  return (
    <section className="mb-6 flex flex-wrap items-start gap-x-8 gap-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-300">
          <Hash size={14} className="text-cyan" />
          {t('instruments.order.title')}
        </h2>
        {data.analyzerNumber ? (
          <>
            <div className="mt-1 flex items-center gap-3">
              <span className="font-mono text-2xl font-bold tracking-wider text-white">
                {data.analyzerNumber}
              </span>
              <button
                type="button"
                onClick={() => copy(data.analyzerNumber as string)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-800"
              >
                <Copy size={12} /> {t('instruments.connectors.copy')}
              </button>
            </div>
            <p className="mt-1 max-w-md text-xs text-gray-400">
              {t('instruments.order.hint')}
            </p>
          </>
        ) : (
          <p className="mt-1 max-w-md text-sm text-gray-400">
            {t('instruments.order.no_number')}
          </p>
        )}
      </div>

      {data.analyzers.length > 0 && (
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {data.analyzers.map((a) => (
            <li
              key={a.analyzerId}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <span className="text-gray-200">{a.analyzerName}</span>
              <span className={STATE_STYLE[a.state]}>
                {t(`instruments.order.state.${a.state}`)}
              </span>
              {a.at && (
                <span className="text-xs text-gray-500">
                  {new Date(a.at).toLocaleString()}
                </span>
              )}
              {a.messageId && (
                <Link
                  to={`/instruments?message=${a.messageId}`}
                  className="text-xs text-cyan hover:underline"
                >
                  {t('instruments.order.open')}
                </Link>
              )}
              {a.reasons.length > 0 && (
                <span className="basis-full text-xs text-gray-400">
                  {a.reasons.map((r) => reasonLabel(t, r)).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
