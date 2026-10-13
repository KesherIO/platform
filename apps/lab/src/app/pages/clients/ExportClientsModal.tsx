import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ApiError, labApi } from '../../shared/api/labApi';
import {
  buildExportCsv,
  type ExportCsvOptions,
} from '../../shared/clientImport';
import { downloadCsv } from './importLabels';

interface Props {
  /** The Clients page's current filters and their result count. */
  status?: string;
  search: string;
  filteredTotal: number;
  onClose: () => void;
}

type Scope = 'all' | 'filtered';

/** "2026-10-13" in the user's time zone, for the file name. */
function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
}

/** The API's row cap, when this is its "too many clients" error. */
function exportTooLargeMax(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  try {
    const body = JSON.parse(err.message) as { code?: string; maxRows?: number };
    return body.code === 'EXPORT_TOO_LARGE' ? body.maxRows ?? null : null;
  } catch {
    return null;
  }
}

/** Client list CSV download (docs/CLIENT_BULK_IMPORT_PLAN.md, B9). */
export function ExportClientsModal({
  status,
  search,
  filteredTotal,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const hasFilters = !!status || !!search;

  const [scope, setScope] = useState<Scope>(
    hasFilters && filteredTotal > 0 ? 'filtered' : 'all'
  );
  const [includeNotes, setIncludeNotes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without filters the page's total is already every client.
  const { data: allData } = useQuery({
    queryKey: ['clients', 'total'],
    queryFn: () => labApi.clients.list({ page: 1, pageSize: 1 }),
    enabled: hasFilters,
  });
  const allTotal = hasFilters ? allData?.total : filteredTotal;
  // Unknown while the total loads: don't block the button for that.
  const selectedCount = scope === 'filtered' ? filteredTotal : allTotal;
  const nothingToExport = selectedCount === 0;

  const filterDescription = [
    status && t(`clients.filter.${status.toLowerCase()}`),
    search && t('clients.export.filter_search', { search }),
  ]
    .filter(Boolean)
    .join(', ');

  const handleDownload = async () => {
    setExporting(true);
    setError(null);
    try {
      const filters =
        scope === 'filtered' ? { status, search: search || undefined } : {};
      const { rows } = await labApi.clients.export({
        ...filters,
        includeNotes,
      });
      const options: ExportCsvOptions = {
        headers: t('clients.import.template', {
          returnObjects: true,
        }) as ExportCsvOptions['headers'],
        clientTypeLabel: (code) =>
          t(`clients.type.${code}`, { defaultValue: code }),
        statusLabel: (s) => t(`clients.status.${s}`),
        includeNotes,
      };
      downloadCsv(
        buildExportCsv(rows, options),
        t('clients.export.filename', { date: localDate() })
      );
      onClose();
    } catch (err) {
      const max = exportTooLargeMax(err);
      setError(
        max !== null
          ? t('clients.export.errors.too_large', { max })
          : t('clients.export.errors.generic')
      );
    } finally {
      setExporting(false);
    }
  };

  const scopeOption = (value: Scope, label: string, disabled = false) => (
    <label
      className={`flex items-center gap-2 text-sm ${
        disabled ? 'text-gray-500' : 'text-white'
      }`}
    >
      <input
        type="radio"
        name="export-scope"
        value={value}
        checked={scope === value}
        disabled={disabled}
        onChange={() => setScope(value)}
        className="h-4 w-4 border-gray-700 bg-gray-800 accent-cyan"
      />
      {label}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {t('clients.export.title')}
          </h2>
        </div>

        <div className="space-y-5 px-6 py-5">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-medium text-gray-400">
              {t('clients.export.scope')}
            </legend>
            {scopeOption(
              'all',
              allTotal === undefined
                ? t('clients.export.all_no_count')
                : t('clients.export.all', { count: allTotal })
            )}
            {hasFilters && (
              <div>
                {scopeOption(
                  'filtered',
                  t('clients.export.filtered', { count: filteredTotal }),
                  filteredTotal === 0
                )}
                <p className="ml-6 text-xs text-gray-500">
                  {filterDescription}
                </p>
              </div>
            )}
          </fieldset>

          <div>
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="h-4 w-4 rounded border-gray-700 bg-gray-800 accent-cyan"
              />
              {t('clients.export.include_notes')}
            </label>
            <p className="ml-6 mt-1 text-xs text-gray-500">
              {t('clients.export.include_notes_hint')}
            </p>
          </div>

          <ul className="space-y-1.5 rounded-lg bg-gray-800/60 px-4 py-3 text-xs text-gray-400">
            <li>{t('clients.export.copy_warning')}</li>
            <li>{t('clients.export.excel_note')}</li>
            <li>{t('clients.export.personal_data')}</li>
          </ul>

          {nothingToExport && (
            <p className="text-xs text-gray-500">
              {t('clients.export.no_clients')}
            </p>
          )}

          {error && (
            <p className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              {t('clients.export.cancel')}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={exporting || nothingToExport}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {exporting
                ? t('clients.export.downloading')
                : t('clients.export.download')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
