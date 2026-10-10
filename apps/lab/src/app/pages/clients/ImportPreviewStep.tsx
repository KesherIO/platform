import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COUNTRY_CODES, countryName } from '../../shared/countries';
import {
  CLIENT_TYPES,
  editRow,
  removeLeadingApostrophe,
  rowBucket,
  rowIssues,
  unconfirmedWarnings,
  warningKey,
} from '../../shared/clientImport';
import { clearInvalidTaxIdType } from '../../shared/taxIdTypes';
import { ClientTaxIdFields } from './ClientTaxIdFields';
import { BUCKET_STYLES, issueText, rowReason } from './importLabels';
import type {
  ImportBucket,
  ImportField,
  ImportPreviewRow,
  ImportRowValues,
} from '../../types/lab.types';

interface Props {
  rows: ImportPreviewRow[];
  duplicates: Set<number>;
  onRowsChange: (
    update: (rows: ImportPreviewRow[]) => ImportPreviewRow[]
  ) => void;
  checkError: boolean;
  onRetryCheck: () => void;
}

const BUCKET_ORDER: ImportBucket[] = [
  'will_create',
  'checking',
  'needs_review',
  'already_in_lab',
  'duplicate_in_file',
  'invalid',
  'excluded',
];

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none';
const LABEL_CLASS = 'mb-1 block text-[11px] text-gray-500';

type Draft = Pick<
  ImportRowValues,
  | 'name'
  | 'primaryContactEmail'
  | 'country'
  | 'taxIdType'
  | 'taxId'
  | 'clientType'
>;

export function ImportPreviewStep({
  rows,
  duplicates,
  onRowsChange,
  checkError,
  onRetryCheck,
}: Props) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<ImportBucket | 'all'>('all');
  const [editing, setEditing] = useState<{
    rowNumber: number;
    draft: Draft;
  } | null>(null);

  const buckets = useMemo(
    () => new Map(rows.map((r) => [r.rowNumber, rowBucket(r, duplicates)])),
    [rows, duplicates]
  );
  const counts = useMemo(() => {
    const c = new Map<ImportBucket, number>();
    for (const b of buckets.values()) c.set(b, (c.get(b) ?? 0) + 1);
    return c;
  }, [buckets]);
  const pendingWarnings = useMemo(
    () =>
      rows.reduce(
        (n, r) =>
          r.excluded ? n : n + unconfirmedWarnings(r, rowIssues(r)).length,
        0
      ),
    [rows]
  );

  const visible =
    filter === 'all'
      ? rows
      : rows.filter((r) => buckets.get(r.rowNumber) === filter);

  const updateRow = (
    rowNumber: number,
    update: (row: ImportPreviewRow) => ImportPreviewRow
  ) =>
    onRowsChange((all) =>
      all.map((r) => (r.rowNumber === rowNumber ? update(r) : r))
    );

  const confirmAllWarnings = () =>
    onRowsChange((all) =>
      all.map((r) => ({
        ...r,
        confirmedWarnings: [
          ...r.confirmedWarnings,
          ...unconfirmedWarnings(r, rowIssues(r)).map(warningKey),
        ],
      }))
    );

  const removeApostrophe = (field: ImportField, rowNumber?: number) =>
    onRowsChange((all) =>
      all.map((r) =>
        rowNumber === undefined || r.rowNumber === rowNumber
          ? editRow(r, { [field]: removeLeadingApostrophe(r.values[field]) })
          : r
      )
    );

  const startEdit = (row: ImportPreviewRow) =>
    setEditing({
      rowNumber: row.rowNumber,
      draft: {
        name: row.values.name,
        primaryContactEmail: row.values.primaryContactEmail,
        country: row.values.country,
        taxIdType: row.values.taxIdType,
        taxId: row.values.taxId,
        clientType: row.values.clientType,
      },
    });

  const saveEdit = () => {
    if (!editing) return;
    updateRow(editing.rowNumber, (r) => editRow(r, editing.draft));
    setEditing(null);
  };

  const setDraft = (changes: Partial<Draft>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...changes } } : e));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {t('clients.import.preview.description')}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={`${t('clients.import.filter_all')} (${rows.length})`}
        />
        {BUCKET_ORDER.filter((b) => counts.get(b)).map((b) => (
          <FilterChip
            key={b}
            active={filter === b}
            onClick={() => setFilter(b)}
            label={`${t(`clients.import.buckets.${b}`)} (${counts.get(b)})`}
          />
        ))}
      </div>

      {checkError && (
        <div className="flex items-center justify-between rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
          <span>{t('clients.import.errors.check')}</span>
          <button
            onClick={onRetryCheck}
            className="font-semibold hover:underline"
          >
            {t('clients.import.preview.retry_check')}
          </button>
        </div>
      )}

      {pendingWarnings > 0 && (
        <button
          onClick={confirmAllWarnings}
          className="rounded-lg border border-yellow-800/60 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-900/20"
        >
          {t('clients.import.preview.confirm_all_warnings', {
            count: pendingWarnings,
          })}
        </button>
      )}

      <div className="max-h-[50vh] overflow-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-900 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.preview.row')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.fields.name')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.fields.primaryContactEmail')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.fields.taxId')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.preview.status')}
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-xs text-gray-500"
                >
                  {t('clients.import.preview.empty_filter')}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const bucket = buckets.get(row.rowNumber) ?? 'checking';
              const warnings = row.excluded
                ? []
                : unconfirmedWarnings(row, rowIssues(row));
              const isEditing = editing?.rowNumber === row.rowNumber;
              return (
                <tr key={row.rowNumber} className="align-top">
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {row.rowNumber}
                  </td>
                  <td
                    className="px-3 py-2 text-white"
                    colSpan={isEditing ? 4 : 1}
                  >
                    {isEditing ? (
                      <RowEditor
                        draft={editing.draft}
                        onChange={setDraft}
                        onSave={saveEdit}
                        onCancel={() => setEditing(null)}
                        language={i18n.language}
                      />
                    ) : (
                      <>
                        <div>{row.values.name}</div>
                        <div className="text-xs text-gray-500">
                          {row.values.country &&
                            countryName(row.values.country, i18n.language)}
                          {row.values.clientType &&
                            ` · ${t(`clients.type.${row.values.clientType}`, {
                              defaultValue: row.values.clientType,
                            })}`}
                        </div>
                      </>
                    )}
                  </td>
                  {!isEditing && (
                    <>
                      <td className="px-3 py-2 text-xs text-gray-300">
                        {row.values.primaryContactEmail}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-300">
                        {row.values.taxIdType && (
                          <span className="mr-1 text-gray-500">
                            {row.values.taxIdType}
                          </span>
                        )}
                        {row.values.taxId}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${BUCKET_STYLES[bucket]}`}
                        >
                          {t(`clients.import.buckets.${bucket}`)}
                        </span>
                        {bucket !== 'needs_review' && (
                          <p className="mt-1 text-[11px] text-gray-400">
                            {rowReason(t, row, bucket)}
                          </p>
                        )}
                        {warnings.map((w) => (
                          <div
                            key={warningKey(w)}
                            className="mt-1 text-[11px] text-yellow-300"
                          >
                            <p>{issueText(t, w)}</p>
                            <div className="mt-0.5 flex flex-wrap gap-2">
                              <button
                                onClick={() =>
                                  updateRow(row.rowNumber, (r) => ({
                                    ...r,
                                    confirmedWarnings: [
                                      ...r.confirmedWarnings,
                                      warningKey(w),
                                    ],
                                  }))
                                }
                                className="font-semibold hover:underline"
                              >
                                {t('clients.import.preview.confirm_warning')}
                              </button>
                              {w.code === 'APOSTROPHE_PREFIX' && (
                                <>
                                  <button
                                    onClick={() =>
                                      removeApostrophe(
                                        w.field as ImportField,
                                        row.rowNumber
                                      )
                                    }
                                    className="hover:underline"
                                  >
                                    {t(
                                      'clients.import.preview.remove_apostrophe'
                                    )}
                                  </button>
                                  <button
                                    onClick={() =>
                                      removeApostrophe(w.field as ImportField)
                                    }
                                    className="hover:underline"
                                  >
                                    {t(
                                      'clients.import.preview.remove_apostrophe_column'
                                    )}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </td>
                    </>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {!isEditing && (
                      <div className="flex justify-end gap-3">
                        {!row.excluded && (
                          <button
                            onClick={() => startEdit(row)}
                            className="text-cyan hover:underline"
                          >
                            {t('clients.import.preview.edit')}
                          </button>
                        )}
                        <button
                          onClick={() =>
                            updateRow(row.rowNumber, (r) => ({
                              ...r,
                              excluded: !r.excluded,
                            }))
                          }
                          className="text-gray-400 hover:underline"
                        >
                          {row.excluded
                            ? t('clients.import.preview.include')
                            : t('clients.import.preview.exclude')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-cyan/20 text-cyan'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function RowEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  language,
}: {
  draft: Draft;
  onChange: (changes: Partial<Draft>) => void;
  onSave: () => void;
  onCancel: () => void;
  language: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL_CLASS}>
            {t('clients.import.fields.name')}
          </label>
          <input
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>
            {t('clients.import.fields.primaryContactEmail')}
          </label>
          <input
            value={draft.primaryContactEmail}
            onChange={(e) => onChange({ primaryContactEmail: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>
            {t('clients.import.fields.country')}
          </label>
          <select
            value={draft.country}
            onChange={(e) =>
              onChange({
                country: e.target.value,
                taxIdType: clearInvalidTaxIdType(
                  e.target.value,
                  draft.taxIdType
                ),
              })
            }
            className={INPUT_CLASS}
          >
            <option value="">{t('clients.form.country_placeholder')}</option>
            {!(COUNTRY_CODES as readonly string[]).includes(draft.country) &&
              draft.country && (
                <option value={draft.country}>{draft.country}</option>
              )}
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {countryName(code, language)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS}>
            {t('clients.import.fields.clientType')}
          </label>
          <select
            value={draft.clientType}
            onChange={(e) => onChange({ clientType: e.target.value })}
            className={INPUT_CLASS}
          >
            {!CLIENT_TYPES.includes(draft.clientType as never) && (
              <option value={draft.clientType}>{draft.clientType}</option>
            )}
            {CLIENT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t(`clients.type.${ct}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ClientTaxIdFields
        country={draft.country}
        taxIdType={draft.taxIdType}
        taxId={draft.taxId}
        onChange={onChange}
        labelClassName={LABEL_CLASS}
        inputClassName={INPUT_CLASS}
      />
      <div className="flex gap-2">
        <button
          onClick={onSave}
          className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-semibold text-gray-950 hover:opacity-90"
        >
          {t('clients.import.preview.save')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
        >
          {t('clients.import.preview.cancel')}
        </button>
      </div>
    </div>
  );
}
