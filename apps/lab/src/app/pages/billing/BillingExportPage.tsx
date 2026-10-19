import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, labApi } from '../../shared/api/labApi';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../shared/components/ToastProvider';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import {
  billingFilename,
  downloadBillingFile,
  type BillingFormat,
} from '../../shared/billingExport';
import type {
  BillingExportSummary,
  BillingMissingCode,
} from '../../types/lab.types';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

const inputClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none';

function MissingCodeRow({
  item,
  canFix,
  onSaved,
}: {
  item: BillingMissingCode;
  /** Owner/Admin set codes; Consulta only downloads */
  canFix: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [value, setValue] = useState('');
  const deleted = item.reason === 'ITEM_NOT_IN_CATALOG';
  const save = useMutation({
    mutationFn: async () => {
      if (!deleted) {
        return labApi.catalog.update(item.catalogItemId, {
          billingCode: value.trim(),
        });
      }
      // The item is gone: the code applies to every order line that still
      // points at it, so the lab reviews exactly what it is assigning first
      const ok = await confirm({
        title: t('billing.export.deleted_confirm_title'),
        message: (
          <span className="whitespace-pre-line">
            {t('billing.export.deleted_confirm_message', {
              name: item.name,
              code: item.internalCode ?? '—',
              billing: value.trim(),
              lines: item.lineCount,
              orders: item.orderCount,
            })}
          </span>
        ),
        confirmLabel: t('billing.export.deleted_confirm_button'),
      });
      if (!ok) return null;
      return labApi.billing.assignDeletedItemCode(
        item.catalogItemId,
        value.trim()
      );
    },
    onSuccess: (res) => {
      if (res) onSaved();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          {item.name}
          {item.internalCode && (
            <span className="ml-2 font-mono text-xs text-gray-400">
              {item.internalCode}
            </span>
          )}
        </p>
        <p className="text-xs text-gray-400">
          {t('billing.export.missing_usage', {
            lines: item.lineCount,
            orders: item.orderCount,
          })}
        </p>
      </div>
      {!canFix ? (
        <p className="max-w-xs text-xs text-red-200">
          {t('billing.export.ask_admin')}
        </p>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save.mutate();
          }}
        >
          {deleted && (
            <p className="w-full text-xs text-red-300">
              {t('billing.export.item_not_in_catalog')}
            </p>
          )}
          <input
            aria-label={t('billing.catalog.billing_code')}
            value={value}
            maxLength={50}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('billing.catalog.billing_code')}
            className={`${inputClass} w-40 font-mono`}
          />
          <button
            type="submit"
            disabled={!value.trim() || save.isPending}
            className="h-9 rounded-lg bg-cyan px-3 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
          >
            {t(
              deleted
                ? 'billing.export.review_and_save'
                : 'billing.export.save_code'
            )}
          </button>
        </form>
      )}
    </li>
  );
}

function HistoryRow({ entry }: { entry: BillingExportSummary }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState<BillingFormat | null>(null);

  const download = async (format: BillingFormat) => {
    setBusy(format);
    try {
      // The rows exactly as generated: today's catalog doesn't change them
      const file = await labApi.billing.getExport(entry.id);
      await downloadBillingFile(
        file.rows,
        format,
        billingFilename(file.dateFrom, file.dateTo, format)
      );
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-white">
          {entry.dateFrom === entry.dateTo
            ? entry.dateFrom
            : `${entry.dateFrom} → ${entry.dateTo}`}
          <span className="ml-2 text-xs text-gray-400">
            {t('billing.export.history_lines', { count: entry.lineCount })}
            {entry.onlyNew && ` · ${t('billing.export.history_only_new')}`}
          </span>
        </p>
        <p className="text-xs text-gray-500">
          {t('billing.export.history_generated', {
            when: new Date(entry.createdAt).toLocaleString(),
            who: entry.createdByName,
          })}
        </p>
      </div>
      {(['xlsx', 'csv'] as const).map((f) => (
        <button
          key={f}
          onClick={() => download(f)}
          disabled={busy !== null}
          className="h-8 rounded-lg border border-gray-700 px-3 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {t('billing.export.redownload', { format: f.toUpperCase() })}
        </button>
      ))}
    </li>
  );
}

export function BillingExportPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [format, setFormat] = useState<BillingFormat>('xlsx');
  const [onlyNew, setOnlyNew] = useState(false);

  const rangeOk = !!dateFrom && !!dateTo && dateFrom <= dateTo;

  const preview = useQuery({
    queryKey: ['billing-preview', dateFrom, dateTo, onlyNew],
    queryFn: () => labApi.billing.preview({ dateFrom, dateTo, onlyNew }),
    enabled: rangeOk,
  });
  const history = useQuery({
    queryKey: ['billing-history'],
    queryFn: () => labApi.billing.history(),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['billing-preview'] });
    queryClient.invalidateQueries({ queryKey: ['catalog'] });
  };

  const generate = useMutation({
    mutationFn: async () => {
      const file = await labApi.billing.generate({ dateFrom, dateTo, onlyNew });
      await downloadBillingFile(
        file.rows,
        format,
        billingFilename(dateFrom, dateTo, format)
      );
      return file;
    },
    onSuccess: (file) => {
      toast.success(t('billing.export.generated', { count: file.rows.length }));
      queryClient.invalidateQueries({ queryKey: ['billing-history'] });
      queryClient.invalidateQueries({ queryKey: ['billing-preview'] });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err));
      // The mapping may have changed under us: show what's missing now
      refresh();
    },
  });

  const data = preview.data;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          to={isAdmin ? '/catalog' : '/results'}
          className="text-xs text-gray-400 hover:text-white"
        >
          ← {t(isAdmin ? 'nav.catalog' : 'nav.results')}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-white">
          {t('billing.export.title')}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-400">
          {t('billing.export.subtitle')}
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-gray-400">
            {t('billing.export.date_from')}
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className={`${inputClass} mt-1 block`}
            />
          </label>
          <label className="text-xs text-gray-400">
            {t('billing.export.date_to')}
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className={`${inputClass} mt-1 block`}
            />
          </label>
          <fieldset className="text-xs text-gray-400">
            <legend>{t('billing.export.format')}</legend>
            <div className="mt-1 flex gap-4 py-2 text-sm text-white">
              {(['xlsx', 'csv'] as const).map((f) => (
                <label key={f} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="billing-format"
                    value={f}
                    checked={format === f}
                    onChange={() => setFormat(f)}
                  />
                  {f === 'xlsx'
                    ? t('billing.export.format_xlsx')
                    : t('billing.export.format_csv')}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={onlyNew}
            onChange={(e) => setOnlyNew(e.target.checked)}
          />
          {t('billing.export.only_new')}
        </label>
        {!rangeOk && (
          <p className="text-sm text-amber-300">
            {t('billing.export.invalid_range')}
          </p>
        )}
      </section>

      {preview.isLoading && (
        <p className="text-sm text-gray-400">{t('billing.export.loading')}</p>
      )}
      {preview.error && (
        <p className="rounded-lg border border-red-900 bg-red-900/20 px-3 py-2 text-sm text-red-300">
          {apiErrorMessage(preview.error)}
        </p>
      )}

      {data && (
        <>
          <section className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-5">
            <p className="text-xs text-gray-500">
              {t('billing.export.timezone_note', { timezone: data.timezone })}
            </p>
            <p className="text-sm text-white">
              {t('billing.export.summary', {
                orders: data.summary.orders,
                lines: data.summary.lines,
              })}
            </p>
            <p className="text-xs text-gray-400">
              {t('billing.export.cancelled_note', {
                count:
                  data.summary.cancelledOrderLines +
                  data.summary.cancelledItemLines,
              })}
            </p>
            {data.summary.alreadyExported > 0 && (
              <p className="rounded-lg border border-amber-900 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
                {t('billing.export.already_exported', {
                  already: data.summary.alreadyExported,
                  fresh: data.summary.notExportedBefore,
                })}
              </p>
            )}
            {data.withdrawnSinceExport.length > 0 && (
              <div className="rounded-lg border border-amber-900 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
                <p className="font-medium">
                  {t('billing.export.withdrawn_title', {
                    count: data.withdrawnSinceExport.length,
                  })}
                </p>
                <p className="text-xs">{t('billing.export.withdrawn_help')}</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {data.withdrawnSinceExport.slice(0, 20).map((w) => (
                    <li key={`${w.orderId}-${w.lineKey}`}>
                      {w.requisitionNumber || w.orderId} · {w.item} ·{' '}
                      {t(`billing.export.withdrawn_reason.${w.reason}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {data.missingCodes.length > 0 && (
            <section className="rounded-xl border border-red-900 bg-red-900/10 p-5">
              <h2 className="text-sm font-semibold text-red-200">
                {t('billing.export.missing_title', {
                  count: data.missingCodes.length,
                })}
              </h2>
              <p className="mt-1 text-xs text-red-200/80">
                {t('billing.export.missing_help')}
              </p>
              <ul className="mt-2 divide-y divide-red-900/40">
                {data.missingCodes.map((m) => (
                  <MissingCodeRow
                    key={m.catalogItemId}
                    item={m}
                    canFix={isAdmin}
                    onSaved={refresh}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">
                {t('billing.export.preview_title')}
              </h2>
              <button
                onClick={() => generate.mutate()}
                disabled={!data.canGenerate || generate.isPending}
                className="h-9 rounded-lg bg-cyan px-4 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {generate.isPending
                  ? t('billing.export.generating')
                  : t('billing.export.generate', {
                      format: format.toUpperCase(),
                    })}
              </button>
            </div>
            {data.summary.lines === 0 && (
              <p className="text-sm text-gray-400">
                {t('billing.export.nothing')}
              </p>
            )}
            {data.lines.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-800/60 uppercase text-gray-400">
                    <tr>
                      {[
                        'fecha',
                        'entidad',
                        'item',
                        'cantidad',
                        'nombre del paciente',
                      ].map((h) => (
                        <th key={h} className="px-3 py-2">
                          {h}
                        </th>
                      ))}
                      <th className="px-3 py-2">
                        {t('billing.export.col_service')}
                      </th>
                      <th className="px-3 py-2">
                        {t('billing.export.col_status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr
                        key={`${l.orderId}-${l.lineKey}`}
                        className="border-t border-gray-800 text-gray-200"
                      >
                        <td className="px-3 py-1.5">{l.fecha}</td>
                        <td className="px-3 py-1.5">{l.entidad}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {l.item ?? (
                            <span className="text-red-300">
                              {t('billing.export.no_code')}
                            </span>
                          )}
                          {l.codeSource === 'DELETED_ITEM' && (
                            <span
                              title={t('billing.export.code_from_deleted')}
                              className="ml-1 font-sans text-amber-300"
                            >
                              *
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">{l.cantidad}</td>
                        <td className="px-3 py-1.5">{l.patientName}</td>
                        <td className="px-3 py-1.5 text-gray-400">
                          {l.serviceName}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {l.previouslyExported ? (
                            <span className="text-amber-300">
                              {t('billing.export.status_exported', {
                                when: new Date(
                                  l.previouslyExported.exportedAt
                                ).toLocaleDateString(),
                              })}
                            </span>
                          ) : l.orderPreviouslyExported ? (
                            <span className="text-cyan">
                              {t('billing.export.status_added_later')}
                            </span>
                          ) : (
                            <span className="text-gray-500">
                              {t('billing.export.status_new')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.linesTruncated && (
              <p className="text-xs text-gray-500">
                {t('billing.export.truncated', { shown: data.lines.length })}
              </p>
            )}
          </section>
        </>
      )}

      <section className="space-y-2 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-white">
          {t('billing.export.history_title')}
        </h2>
        <p className="text-xs text-gray-400">
          {t('billing.export.history_help')}
        </p>
        {history.data?.data.length === 0 && (
          <p className="text-sm text-gray-500">
            {t('billing.export.history_empty')}
          </p>
        )}
        <ul className="divide-y divide-gray-800">
          {history.data?.data.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </section>
    </div>
  );
}
