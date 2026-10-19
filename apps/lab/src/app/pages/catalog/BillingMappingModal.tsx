import { useRef, useState, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage, labApi } from '../../shared/api/labApi';
import {
  SpreadsheetParseError,
  readSpreadsheet,
} from '../../shared/spreadsheet';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import type {
  MappingAssignment,
  MappingSuggestion,
} from '../../types/lab.types';
import { errorBody, readMappingRows } from './billingMapping';

interface Props {
  onClose: () => void;
  onApplied: () => void;
}

/**
 * Pairs the lab's billing list with catalog items it already has. Nothing is
 * created and nothing is saved until "Apply": a clear single match comes
 * pre-selected, anything ambiguous starts empty and needs an explicit pick,
 * and rows the lab doesn't offer are simply listed as not in the catalog.
 */
export function BillingMappingModal({ onClose, onApplied }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MappingSuggestion[] | null>(null);
  // row index → chosen catalog item id ('' = none)
  const [choice, setChoice] = useState<Record<number, string>>({});

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const sheet = await readSpreadsheet(file);
      const fileRows = readMappingRows(sheet);
      if (!fileRows) {
        setError(t('billing.mapping.errors.columns'));
        return;
      }
      if (fileRows.length === 0) {
        setError(t('billing.mapping.errors.empty'));
        return;
      }
      const { suggestions } = await labApi.billing.suggestMapping(
        fileRows.map(({ code, description }) => ({ code, description }))
      );
      setRows(suggestions);
      setChoice(
        Object.fromEntries(
          suggestions.map((s) => [s.index, s.suggestedCatalogItemId ?? ''])
        )
      );
    } catch (err) {
      setError(
        err instanceof SpreadsheetParseError
          ? t(`billing.mapping.errors.${err.code}`)
          : apiErrorMessage(err)
      );
    } finally {
      setLoading(false);
    }
  };

  const picked = rows ? rows.filter((r) => choice[r.index]).map((r) => r) : [];
  const itemUse = new Map<string, number>();
  for (const r of picked) {
    itemUse.set(choice[r.index], (itemUse.get(choice[r.index]) ?? 0) + 1);
  }
  const duplicateItem = [...itemUse.values()].some((n) => n > 1);

  const apply = async () => {
    if (!rows) return;
    const assignments: MappingAssignment[] = picked.map((r) => ({
      catalogItemId: choice[r.index],
      billingCode: r.code,
    }));
    setApplying(true);
    setError(null);
    try {
      let replaceExisting = false;
      for (;;) {
        try {
          const res = await labApi.billing.applyMapping({
            assignments,
            replaceExisting,
          });
          toast.success(
            t('billing.mapping.applied', {
              updated: res.updated,
              unchanged: res.unchanged,
            })
          );
          onApplied();
          onClose();
          return;
        } catch (err) {
          const body = errorBody(err);
          if (
            !replaceExisting &&
            body?.code === 'BILLING_CODE_REPLACE_NOT_CONFIRMED'
          ) {
            const items = (body.items ?? []) as Array<{
              name: string;
              currentBillingCode: string;
              newBillingCode: string;
            }>;
            const ok = await confirm({
              title: t('billing.mapping.replace_title'),
              message: (
                <span className="whitespace-pre-line">
                  {items
                    .map(
                      (i) =>
                        `${i.name}: ${i.currentBillingCode} → ${i.newBillingCode}`
                    )
                    .join('\n')}
                </span>
              ),
              confirmLabel: t('billing.mapping.replace_confirm'),
            });
            if (!ok) return;
            replaceExisting = true;
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const counts = rows && {
    suggested: rows.filter((r) => r.status === 'SUGGESTED').length,
    review: rows.filter((r) => r.status === 'REVIEW').length,
    none: rows.filter((r) => r.status === 'NO_MATCH' || r.status === 'INVALID')
      .length,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {t('billing.mapping.title')}
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            {t('billing.mapping.subtitle')}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!rows && (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">
                {t('billing.mapping.upload_help')}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={handleFile}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                className="h-9 rounded-lg bg-cyan px-4 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {loading
                  ? t('billing.mapping.reading')
                  : t('billing.mapping.choose_file')}
              </button>
            </div>
          )}

          {rows && counts && (
            <>
              <p className="text-sm text-gray-300">
                {t('billing.mapping.summary', counts)}
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-800/60 text-xs uppercase text-gray-400">
                    <tr>
                      <th className="px-3 py-2">
                        {t('billing.mapping.col_code')}
                      </th>
                      <th className="px-3 py-2">
                        {t('billing.mapping.col_description')}
                      </th>
                      <th className="px-3 py-2">
                        {t('billing.mapping.col_catalog_item')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.index} className="border-t border-gray-800">
                        <td className="px-3 py-2 align-top font-mono text-white">
                          {r.code}
                        </td>
                        <td className="px-3 py-2 align-top text-gray-300">
                          {r.description}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {r.status === 'NO_MATCH' && (
                            <span className="text-xs text-gray-500">
                              {t('billing.mapping.no_match')}
                            </span>
                          )}
                          {r.status === 'INVALID' && (
                            <span className="text-xs text-red-300">
                              {t('billing.mapping.invalid')}
                            </span>
                          )}
                          {(r.status === 'SUGGESTED' ||
                            r.status === 'REVIEW') && (
                            <div className="space-y-1">
                              {r.reasons.length > 0 && (
                                <p className="text-xs text-amber-300">
                                  {r.reasons
                                    .map((x) =>
                                      t(`billing.mapping.reason.${x}`)
                                    )
                                    .join(' · ')}
                                </p>
                              )}
                              <select
                                aria-label={t(
                                  'billing.mapping.col_catalog_item'
                                )}
                                value={choice[r.index] ?? ''}
                                onChange={(e) =>
                                  setChoice((c) => ({
                                    ...c,
                                    [r.index]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none"
                              >
                                <option value="">
                                  {t('billing.mapping.skip')}
                                </option>
                                {r.candidates.map((c) => (
                                  <option
                                    key={c.catalogItemId}
                                    value={c.catalogItemId}
                                  >
                                    {c.name}
                                    {c.internalCode
                                      ? ` (${c.internalCode})`
                                      : ''}
                                    {` · ${t(`catalog.kind.${c.kind}`)}`}
                                    {c.currentBillingCode
                                      ? ` · ${t('billing.mapping.currently')} ${
                                          c.currentBillingCode
                                        }`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {duplicateItem && (
                <p className="text-sm text-red-300">
                  {t('billing.mapping.errors.duplicate_item')}
                </p>
              )}
            </>
          )}

          {error && (
            <p className="whitespace-pre-line rounded-lg border border-red-900 bg-red-900/20 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-6 py-4">
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-gray-700 px-4 text-sm font-semibold text-gray-300 hover:bg-gray-800"
          >
            {t('billing.mapping.close')}
          </button>
          {rows && (
            <button
              onClick={apply}
              disabled={applying || picked.length === 0 || duplicateItem}
              className="h-9 rounded-lg bg-cyan px-4 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {applying
                ? t('billing.mapping.applying')
                : t('billing.mapping.apply', { count: picked.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
