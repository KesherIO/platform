import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { ReleasePdfMenu } from '../../shared/components/ReleasePdfMenu';
import {
  displayResultValue,
  flagClass,
  flagLabel,
} from '../../shared/resultValue';

/**
 * Expanded released row: the complete released report of the order (current
 * version of every released test), the searched analyte highlighted, the
 * PDFs and the version history. Read-only, no link into the workspace.
 */
export function ReleasedResultDetail({
  orderId,
  requisitionNumber,
  highlightCode,
}: {
  orderId: string;
  requisitionNumber: string;
  highlightCode?: string;
}) {
  const { t, i18n } = useTranslation();

  const current = useQuery({
    queryKey: ['current-results', orderId],
    queryFn: () => labApi.release.getCurrentResults(orderId),
  });
  const history = useQuery({
    queryKey: ['release-history', orderId],
    queryFn: () => labApi.release.getHistory(orderId),
  });

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  if (current.isLoading || history.isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-gray-800" />
        ))}
      </div>
    );
  }

  if (current.error || history.error) {
    return (
      <p className="px-5 py-4 text-sm text-red-300">
        {t('results.detail.error')}
      </p>
    );
  }

  const releases = [...(history.data?.releases ?? [])].sort(
    (a, b) => a.releaseSequence - b.releaseSequence
  );
  let corrections = 0;
  const versionLabel = (type: string) =>
    type === 'AMENDMENT'
      ? t('results.detail.correction', { n: ++corrections })
      : t('results.detail.original');

  return (
    <div className="space-y-5 border-t border-gray-800 bg-gray-950/40 px-5 py-4">
      {(current.data?.tests ?? []).map((test) => (
        <section key={`${test.catalogItemCode}-${test.releaseSequence}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              {test.catalogItemName}
            </h3>
            {test.releaseType === 'AMENDMENT' && (
              <StatusBadge status="AMENDMENT" size="sm" />
            )}
            <span className="text-xs text-gray-500">
              {formatDate(test.releasedAt)} · {test.signerName}
            </span>
          </div>
          <div className="divide-y divide-gray-800/60 rounded-lg border border-gray-800">
            {test.analytes.map((a) =>
              a.isHeader ? (
                <p
                  key={a.code}
                  className="bg-gray-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400"
                >
                  {a.name}
                </p>
              ) : (
                <div
                  key={a.code}
                  className={`grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-sm ${
                    a.code === highlightCode ? 'bg-cyan/10' : ''
                  }`}
                >
                  <span
                    className={
                      a.code === highlightCode
                        ? 'font-medium text-cyan'
                        : 'text-gray-300'
                    }
                  >
                    {a.name}
                  </span>
                  <span
                    className={`text-right font-medium ${flagClass(a.flag)}`}
                    style={
                      a.valueType === 'LONG_TEXT'
                        ? { whiteSpace: 'pre-wrap' }
                        : undefined
                    }
                  >
                    {displayResultValue(a)}
                    {a.unit && (
                      <span className="ml-1 text-xs text-gray-500">
                        {a.unit}
                      </span>
                    )}
                    {flagLabel(a.flag) && (
                      <span className="ml-1 text-xs">{flagLabel(a.flag)}</span>
                    )}
                  </span>
                </div>
              )
            )}
          </div>
        </section>
      ))}

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('results.detail.history')}
          </h3>
          <ol className="space-y-1 text-sm">
            {releases.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="text-gray-200">
                  {versionLabel(r.releaseType)}
                </span>
                <span className="text-xs text-gray-500">
                  {formatDate(r.releasedAt)} ·{' '}
                  {r.tests.map((x) => x.catalogItemName).join(', ')}
                </span>
              </li>
            ))}
          </ol>
        </div>
        {releases.length > 0 && (
          <ReleasePdfMenu
            orderId={orderId}
            requisitionNumber={requisitionNumber}
            releases={releases}
          />
        )}
      </section>
    </div>
  );
}
