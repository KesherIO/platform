import { useTranslation } from 'react-i18next';
import { BUCKET_STYLES, rowReason } from './importLabels';
import type { ImportBucket, ImportPreviewRow } from '../../types/lab.types';

interface Props {
  rows: ImportPreviewRow[];
  buckets: Map<number, ImportBucket>;
  running: boolean;
  progress: { done: number; total: number };
  runError: string | null;
  canResume: boolean;
  onResume: () => void;
  onDownloadRetry: () => void;
}

const SUMMARY_ORDER: ImportBucket[] = [
  'created',
  'already_in_lab',
  'duplicate_in_file',
  'invalid',
  'excluded',
  'failed',
  'not_confirmed',
];

/** Progress while importing, then the summary — built only from responses. */
export function ImportResultStep({
  rows,
  buckets,
  running,
  progress,
  runError,
  canResume,
  onResume,
  onDownloadRetry,
}: Props) {
  const { t } = useTranslation();

  if (running) {
    const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
    return (
      <div className="space-y-3 py-6">
        <p className="text-sm font-medium text-white">
          {t('clients.import.result.importing', progress)}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-gray-800">
          <div
            className="h-full bg-cyan transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">
          {t('clients.import.result.do_not_close')}
        </p>
      </div>
    );
  }

  const counts = new Map<ImportBucket, number>();
  for (const b of buckets.values()) counts.set(b, (counts.get(b) ?? 0) + 1);
  const notCreated = rows.filter((r) => buckets.get(r.rowNumber) !== 'created');
  const attempted = rows.filter((r) => r.imported !== null);
  const allExisting =
    attempted.length > 0 &&
    attempted.every((r) => buckets.get(r.rowNumber) === 'already_in_lab');

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white">
        {t('clients.import.result.summary')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {SUMMARY_ORDER.filter((b) => counts.get(b)).map((b) => (
          <span
            key={b}
            className={`rounded-full px-3 py-1 text-xs font-medium ${BUCKET_STYLES[b]}`}
          >
            {t(`clients.import.buckets.${b}`)}: {counts.get(b)}
          </span>
        ))}
      </div>

      {runError && (
        <p className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
          {t('clients.import.errors.import')} {runError}
        </p>
      )}
      {canResume && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-purple/10 px-3 py-2 text-xs text-gray-300">
          <span>{t('clients.import.result.stopped')}</span>
          <button
            onClick={onResume}
            className="shrink-0 rounded-lg bg-purple px-3 py-1.5 font-semibold text-white hover:opacity-90"
          >
            {t('clients.import.result.resume')}
          </button>
        </div>
      )}
      {allExisting && (
        <p className="rounded-lg bg-gray-800 px-3 py-2 text-xs text-gray-300">
          {t('clients.import.result.all_existing')}
        </p>
      )}

      {notCreated.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-gray-400">
              {t('clients.import.result.rows_not_created')} ({notCreated.length}
              )
            </h4>
            <button
              onClick={onDownloadRetry}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
            >
              {t('clients.import.result.download_retry')}
            </button>
          </div>
          <div className="max-h-[40vh] overflow-auto rounded-xl border border-gray-800">
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-gray-800">
                {notCreated.map((row) => {
                  const bucket = buckets.get(row.rowNumber) ?? 'failed';
                  return (
                    <tr key={row.rowNumber} className="align-top">
                      <td className="px-3 py-2 text-gray-500">
                        {row.rowNumber}
                      </td>
                      <td className="px-3 py-2 text-white">
                        {row.values.name}
                        <div className="text-gray-500">
                          {row.values.primaryContactEmail}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 font-medium ${BUCKET_STYLES[bucket]}`}
                        >
                          {t(`clients.import.buckets.${bucket}`)}
                        </span>
                        <p className="mt-1 text-gray-400">
                          {rowReason(t, row, bucket)}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
