import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Download,
  X,
  Scissors,
  RefreshCw,
  Ban,
  CheckCircle2,
  Link2,
} from 'lucide-react';
import { apiErrorMessage, labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { useToast } from '../../shared/components/ToastProvider';
import { useAuth } from '../../auth/AuthContext';
import { ReasonDialog } from '../settings/ReasonDialog';
import { InstrumentFlagBadges } from './InstrumentFlagBadges';
import {
  APPROVABLE,
  reasonCode,
  reasonLabel,
  STATUS_STYLE,
} from './instrumentReasons';
import type {
  InstrumentMessageDetail,
  InstrumentParameter,
  LabOrderSummary,
} from '../../types/lab.types';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

function OrderPicker({ onPick }: { onPick: (o: LabOrderSummary) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['instrument-order-search', search],
    queryFn: () => labApi.orders.list({ search, pageSize: 6 }),
    enabled: search.trim().length >= 2,
  });
  return (
    <div>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('instruments.detail.order_search')}
      />
      <ul className="mt-2 space-y-1">
        {(data?.data ?? []).map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick(o)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-800 px-3 py-2 text-left text-sm hover:border-cyan/40 hover:bg-gray-800"
            >
              <span className="font-medium text-white">
                {o.requisitionNumber}
              </span>
              <span className="text-gray-400">
                {o.patientName} · {o.clinicName}
              </span>
            </button>
          </li>
        ))}
        {!isFetching &&
          search.trim().length >= 2 &&
          (data?.data.length ?? 0) === 0 && (
            <li className="px-1 text-sm text-gray-500">
              {t('instruments.detail.no_orders')}
            </li>
          )}
      </ul>
    </div>
  );
}

function ParamRow({
  p,
  ignored,
  target,
  unitProblem,
}: {
  p: InstrumentParameter;
  ignored?: string;
  target?: string;
  unitProblem?: string;
}) {
  const { t } = useTranslation();
  const abnormal = p.abnormalFlag === 'H' || p.abnormalFlag === 'L';
  return (
    <tr className="border-t border-gray-800">
      <td className="py-1.5 pr-3 text-gray-200">{p.code}</td>
      <td
        className={`py-1.5 pr-3 font-mono ${
          abnormal ? 'text-amber-300' : 'text-white'
        }`}
      >
        {p.value || '—'}{' '}
        {p.abnormalFlag && <span className="text-xs">{p.abnormalFlag}</span>}
      </td>
      <td className="py-1.5 pr-3 text-gray-400">{p.unit}</td>
      <td className="py-1.5 pr-3 text-gray-500">{p.referenceRange}</td>
      <td className="py-1.5 text-xs">
        {p.userFlag === 'O' && (
          <span className="text-red-300">
            {t('instruments.badge.expired_reagent')}
          </span>
        )}
        {(p.userFlag === 'E' || p.userFlag === 'e') && (
          <span className="text-blue-300">{t('instruments.badge.edited')}</span>
        )}
        {target && (
          <span className="text-cyan">
            {t('instruments.detail.mapping_to', { field: target })}
          </span>
        )}
        {unitProblem && (
          <span className="text-amber-300">
            {t('instruments.detail.mapping_unit_row', { units: unitProblem })}
          </span>
        )}
        {ignored && !target && !unitProblem && (
          <span className="text-gray-500">
            {t('instruments.ignored.' + ignored, { defaultValue: ignored })}
          </span>
        )}
      </td>
    </tr>
  );
}

export function InstrumentDetailPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { canRelease } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<LabOrderSummary | null>(null);
  const [dialog, setDialog] = useState<'dismiss' | 'approve' | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const {
    data: m,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['instrument-message', id],
    queryFn: () => labApi.instruments.get(id),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['instrument-messages'] });
    queryClient.invalidateQueries({ queryKey: ['instrument-summary'] });
    queryClient.invalidateQueries({ queryKey: ['instrument-message', id] });
  };
  const run = async (
    action: () => Promise<{ status: string }>,
    okKey: string
  ) => {
    setBusy(true);
    try {
      const r = await action();
      toast.success(
        t(okKey, {
          status: t(`instruments.status.${r.status}`, {
            defaultValue: r.status,
          }),
        })
      );
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    try {
      const { blob, fileName } = await labApi.instruments.downloadRaw(id);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: fileName,
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  const open =
    m &&
    !m.resolvedAt &&
    ['UNMATCHED', 'AMBIGUOUS', 'NEEDS_REVIEW', 'FAILED', 'INCOMPLETE'].includes(
      m.status
    );
  const approvable = m
    ? m.reasons.map(reasonCode).filter((r) => APPROVABLE.includes(r))
    : [];
  const blocking = m
    ? m.reasons.filter((r) => !APPROVABLE.includes(reasonCode(r)))
    : [];
  const mp = m?.mappingPreview ?? null;
  const targetByCode = new Map(
    (mp?.importable ?? []).map((i) => [i.analyzerCode, i.analyteCode])
  );
  const unitByCode = new Map(
    (mp?.unitMismatches ?? []).map((u) => [u.code, u.mappedUnits.join(', ')])
  );
  const ignoredByCode = new Map(
    (mp?.notImported ?? []).map((i) => [i.code, i.reason])
  );

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-2xl overflow-y-auto border-l border-gray-800 bg-gray-950 p-6 shadow-2xl">
      <div className="mb-4 flex items-start justify-between">
        <h2 className="text-lg font-bold text-white">
          {t('instruments.detail.title')}{' '}
          {m?.sampleId ? `· ${t('instruments.col.sample')} ${m.sampleId}` : ''}
        </h2>
        <button
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Close' })}
          className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>

      {isLoading && (
        <div className="h-40 animate-pulse rounded-xl bg-gray-900" />
      )}
      {error && (
        <p className="text-sm text-red-400">{apiErrorMessage(error)}</p>
      )}

      {m && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                STATUS_STYLE[m.status]
              }`}
            >
              {t(`instruments.status.${m.status}`, { defaultValue: m.status })}
            </span>
            <InstrumentFlagBadges m={m} />
          </div>

          {!m.isComplete && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              <p className="flex items-center gap-2 font-semibold">
                <Scissors size={16} />{' '}
                {t('instruments.detail.incomplete_title')}
              </p>
              <p className="mt-1">
                {t('instruments.detail.incomplete_body', {
                  reason: m.incompleteReason ?? '',
                })}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">{t('instruments.col.analyzer')}</dt>
            <dd className="text-gray-200">{m.analyzer.name}</dd>
            <dt className="text-gray-500">
              {t('instruments.detail.run_time')}
            </dt>
            <dd className="text-gray-200">{fmt(m.observationTime)}</dd>
            <dt className="text-gray-500">
              {t('instruments.detail.control_id')}
            </dt>
            <dd className="text-gray-200">{m.controlId ?? '—'}</dd>
            <dt className="text-gray-500">
              {t('instruments.detail.received')}
            </dt>
            <dd className="text-gray-200">{fmt(m.receivedAtConnector)}</dd>
            <dt className="text-gray-500">{t('instruments.col.order')}</dt>
            <dd className="text-gray-200">
              {m.order ? (
                <Link
                  className="text-cyan hover:underline"
                  to={`/orders/${m.order.id}`}
                >
                  {m.order.requisitionNumber}
                </Link>
              ) : (
                '—'
              )}
            </dd>
            {m.parsed?.patient.name && (
              <>
                <dt className="text-gray-500">
                  {t('instruments.detail.analyzer_patient')}
                </dt>
                <dd className="text-gray-200">{m.parsed.patient.name}</dd>
              </>
            )}
          </dl>

          {m.reasons.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <h3 className="mb-2 text-sm font-semibold text-white">
                {t('instruments.detail.why')}
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
                {m.reasons.map((r) => (
                  <li key={r}>
                    {reasonLabel(t, r)}
                    {APPROVABLE.includes(reasonCode(r)) ? (
                      ''
                    ) : (
                      <span className="ml-2 text-xs text-gray-500">
                        {t('instruments.detail.must_fix')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {m.processingError && (
                <p className="mt-2 text-xs text-gray-500">
                  {m.processingError}
                </p>
              )}
            </div>
          )}

          {m.diff &&
            (m.diff.changed.length > 0 ||
              m.diff.imagesChanged.length > 0 ||
              m.diff.patientChanged.length > 0) && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <h3 className="mb-2 text-sm font-semibold text-amber-200">
                  {t('instruments.detail.changes')}
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {m.diff.changed.map((c) => (
                      <tr key={c.code} className="border-t border-amber-500/10">
                        <td className="py-1 pr-3 text-gray-200">{c.code}</td>
                        <td className="py-1 pr-3 font-mono text-gray-400 line-through">
                          {c.before.value} {c.before.userFlag}
                        </td>
                        <td className="py-1 font-mono text-white">
                          {c.after.value} {c.after.userFlag}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {m.diff.imagesChanged.length > 0 && (
                  <p className="mt-2 text-xs text-amber-200">
                    {t('instruments.detail.images_changed', {
                      list: m.diff.imagesChanged.join(', '),
                    })}
                  </p>
                )}
                {m.diff.patientChanged.map((p) => (
                  <p key={p.field} className="mt-1 text-xs text-amber-200">
                    {p.field}: {p.before ?? '—'} → {p.after ?? '—'}
                  </p>
                ))}
              </div>
            )}

          {mp && (
            <div
              className={`rounded-xl border p-4 text-sm ${
                mp.isPartial
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-gray-800 bg-gray-900'
              }`}
            >
              <h3 className="mb-1 font-semibold text-white">
                {t('instruments.detail.mapping_title')}
              </h3>
              <p className="text-gray-300">
                {t('instruments.detail.mapping_summary', {
                  count: new Set(mp.importable.map((i) => i.analyzerCode)).size,
                  total: mp.numericParameters,
                })}
              </p>
              {mp.importable.length === 0 && (
                <p className="mt-1 text-amber-200">
                  {t('instruments.detail.mapping_none')}
                </p>
              )}
              {mp.isPartial && (
                <p className="mt-1 font-medium text-amber-200">
                  {t('instruments.detail.mapping_partial')}
                </p>
              )}
              {mp.notMapped.length > 0 && (
                <p className="mt-1 text-xs text-gray-400">
                  {t('instruments.detail.mapping_not_mapped', {
                    list: mp.notMapped.join(', '),
                  })}
                </p>
              )}
              {mp.unitMismatches.length > 0 && (
                <p className="mt-1 text-xs text-amber-200">
                  {t('instruments.detail.mapping_unit', {
                    list: mp.unitMismatches
                      .map((u) => `${u.code} (${u.unit || '—'})`)
                      .join(', '),
                  })}
                </p>
              )}
            </div>
          )}

          {m.status === 'IMPORTED' && m.order && m.orderedTestId && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-sm">
              <p className="text-xs text-gray-400">
                {t('instruments.detail.open_draft_help')}
              </p>
              <Link
                to={`/orders/${m.order.id}/tests/${m.orderedTestId}/results`}
                className="mt-2 inline-flex items-center rounded-lg bg-cyan px-3 py-1.5 font-semibold text-gray-950 hover:opacity-90"
              >
                {t('instruments.detail.open_draft')} ·{' '}
                {m.order.requisitionNumber}
              </Link>
            </div>
          )}

          {(m.parsed?.import?.formulaComputed?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
              <p className="font-semibold text-blue-200">
                {t('instruments.detail.formula_title')}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {t('instruments.detail.formula_help')}
              </p>
              <p className="mt-1 text-xs text-gray-300">
                {m.parsed?.import?.formulaComputed
                  ?.map(
                    (f) =>
                      `${f.analyteCode} (${t(
                        'instruments.detail.analyzer_said'
                      )} ${f.analyzerValue})`
                  )
                  .join(' · ')}
              </p>
            </div>
          )}

          {m.parsed && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-white">
                {t('instruments.detail.parameters')}
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-1 font-medium">
                      {t('instruments.detail.parameter')}
                    </th>
                    <th className="pb-1 font-medium">
                      {t('instruments.detail.value')}
                    </th>
                    <th className="pb-1 font-medium">
                      {t('instruments.detail.unit')}
                    </th>
                    <th className="pb-1 font-medium">
                      {t('instruments.detail.range')}
                    </th>
                    <th className="pb-1 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {m.parsed.parameters
                    .filter((p) => p.valueType === 'NM')
                    .map((p) => (
                      <ParamRow
                        key={p.code}
                        p={p}
                        ignored={ignoredByCode.get(p.code)}
                        target={targetByCode.get(p.code)}
                        unitProblem={unitByCode.get(p.code)}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Actions ───────────────────────────────────────────────── */}
          {open &&
            m.isComplete &&
            (m.status === 'UNMATCHED' || m.status === 'AMBIGUOUS') && (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
                  <Link2 size={16} />{' '}
                  {t('instruments.detail.link_title', { sample: m.sampleId })}
                </h3>
                <p className="mb-3 text-xs text-gray-500">
                  {t('instruments.detail.link_help')}
                </p>
                {picked ? (
                  <div className="flex items-center justify-between rounded-lg border border-cyan/30 bg-cyan/5 px-3 py-2 text-sm">
                    <span className="text-white">
                      {picked.requisitionNumber} · {picked.patientName}
                    </span>
                    <span className="flex gap-2">
                      <button
                        className="text-gray-400 hover:text-white"
                        onClick={() => setPicked(null)}
                      >
                        {t('instruments.detail.change')}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              labApi.instruments.resolveSample(id, picked.id),
                            'instruments.toast.linked'
                          )
                        }
                        className="rounded-lg bg-cyan px-3 py-1 font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                      >
                        {t('instruments.detail.link_and_import')}
                      </button>
                    </span>
                  </div>
                ) : (
                  <OrderPicker onPick={setPicked} />
                )}
              </div>
            )}

          {open && m.status === 'NEEDS_REVIEW' && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              {blocking.length > 0 && (
                <p className="mb-3 text-sm text-gray-300">
                  {t('instruments.detail.fix_then_reprocess')}
                </p>
              )}
              {approvable.length > 0 &&
                blocking.length === 0 &&
                (canRelease ? (
                  <>
                    <p className="mb-2 text-sm font-semibold text-white">
                      {t('instruments.detail.approve_title')}
                    </p>
                    {approvable.map((r) => (
                      <label
                        key={r}
                        className="mb-1 flex items-center gap-2 text-sm text-gray-300"
                      >
                        <input
                          type="checkbox"
                          checked={accepted.includes(r)}
                          onChange={(e) =>
                            setAccepted((a) =>
                              e.target.checked
                                ? [...a, r]
                                : a.filter((x) => x !== r)
                            )
                          }
                        />
                        {reasonLabel(t, r)}
                      </label>
                    ))}
                    <button
                      disabled={
                        busy || approvable.some((r) => !accepted.includes(r))
                      }
                      onClick={() => setDialog('approve')}
                      className="mt-3 flex items-center gap-2 rounded-lg bg-cyan px-3 py-1.5 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-40"
                    >
                      <CheckCircle2 size={16} />{' '}
                      {t('instruments.detail.approve_import')}
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">
                    {t('instruments.detail.reviewer_only')}
                  </p>
                ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-gray-800 pt-4">
            {open && m.isComplete && m.status !== 'INCOMPLETE' && (
              <button
                disabled={busy}
                onClick={() =>
                  run(
                    () => labApi.instruments.reprocess(id),
                    'instruments.toast.reprocessed'
                  )
                }
                className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
              >
                <RefreshCw size={15} /> {t('instruments.detail.reprocess')}
              </button>
            )}
            {open && (
              <button
                disabled={busy}
                onClick={() => setDialog('dismiss')}
                className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
              >
                <Ban size={15} />{' '}
                {m.status === 'INCOMPLETE'
                  ? t('instruments.detail.acknowledge')
                  : t('instruments.detail.dismiss')}
              </button>
            )}
            <button
              onClick={download}
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
            >
              <Download size={15} /> {t('instruments.detail.download_raw')}
            </button>
          </div>

          {m.reviewNote && (
            <p className="text-xs text-gray-500">
              {t('instruments.detail.note')}: {m.reviewNote}{' '}
              {m.reviewedAt ? `(${fmt(m.reviewedAt)})` : ''}
            </p>
          )}

          {m.history.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('instruments.detail.history')}
              </h3>
              <ul className="space-y-0.5 text-xs text-gray-400">
                {m.history.map((h) => (
                  <li key={h.id}>
                    {fmt(h.createdAt)} ·{' '}
                    {t(`instruments.status.${h.status}`, {
                      defaultValue: h.status,
                    })}
                    {!h.isComplete && ` · ${t('instruments.badge.incomplete')}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {dialog === 'dismiss' && m && (
        <ReasonDialog
          title={
            m.status === 'INCOMPLETE'
              ? t('instruments.detail.acknowledge')
              : t('instruments.detail.dismiss')
          }
          message={
            m.status === 'INCOMPLETE'
              ? t('instruments.detail.acknowledge_help')
              : t('instruments.detail.dismiss_help')
          }
          confirmLabel={
            m.status === 'INCOMPLETE'
              ? t('instruments.detail.acknowledge')
              : t('instruments.detail.dismiss')
          }
          required
          destructive={m.status !== 'INCOMPLETE'}
          icon={Ban}
          onCancel={() => setDialog(null)}
          onSubmit={async (note) => {
            await labApi.instruments.dismiss(id, note);
            toast.success(t('instruments.toast.dismissed'));
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog === 'approve' && m && (
        <ReasonDialog
          title={t('instruments.detail.approve_import')}
          message={t('instruments.detail.approve_help')}
          confirmLabel={t('instruments.detail.approve_import')}
          required
          icon={CheckCircle2}
          onCancel={() => setDialog(null)}
          onSubmit={async (note) => {
            const r = await labApi.instruments.approve(id, approvable, note);
            toast.success(
              t('instruments.toast.approved', {
                status: t(`instruments.status.${r.status}`, {
                  defaultValue: r.status,
                }),
              })
            );
            setDialog(null);
            refresh();
          }}
        />
      )}
    </aside>
  );
}

export type { InstrumentMessageDetail };
