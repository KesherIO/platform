import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Receipt } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { DateRangeFilter } from '../../shared/components/DateRangeFilter';
import { Pagination } from '../../shared/components/Pagination';
import { StatusBadge } from '../../shared/components/StatusBadge';
import {
  displayResultValue,
  flagClass,
  flagLabel,
} from '../../shared/resultValue';
import type {
  InProgressResultRow,
  ReleasedResultRow,
  ResultsAnalyte,
  ResultsView,
} from '../../types/lab.types';
import { AnalytePicker } from './AnalytePicker';
import { ReleasedResultDetail } from './ReleasedResultDetail';

const PAGE_SIZE = 20;

const TAB =
  'flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950';
const TAB_ACTIVE = 'border-cyan/30 bg-cyan/10 text-cyan';
const TAB_INACTIVE =
  'border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white';

/** The API's error message from an ApiError body ({ message }), else the raw text */
function apiMessage(err: unknown): string {
  const raw = (err as Error).message;
  try {
    const m = JSON.parse(raw).message;
    return Array.isArray(m) ? m.join(' ') : String(m ?? raw);
  } catch {
    return raw;
  }
}

/**
 * Resultados (docs/RESULTS_SEARCH_PLAN.md rev. 2): search this lab's released
 * results by clinic, date, patient and analyte. "En proceso" lists open tests
 * with their status only, for staff and for Consulta with that checkbox.
 */
export function ResultsPage() {
  const { t, i18n } = useTranslation();
  const { isResultsViewer, canViewInProgress, isAdmin } = useAuth();
  // Billing export: Owner/Admin, or Consulta with the in-progress checkbox
  const canExportBilling = isAdmin || (isResultsViewer && canViewInProgress);
  const canSeeInProgress = !isResultsViewer || canViewInProgress;

  const [view, setView] = useState<ResultsView>('released');
  const [clinicId, setClinicId] = useState('');
  // Empty = the API's default (last 30 days without other filters)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [patient, setPatient] = useState('');
  const [analyte, setAnalyte] = useState<ResultsAnalyte | null>(null);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const resetPage = () => {
    setPage(1);
    setExpandedId(null);
  };

  const { data: clinics = [] } = useQuery({
    queryKey: ['results-clinics'],
    queryFn: () => labApi.results.clinics(),
    staleTime: 5 * 60_000,
  });

  const query = {
    view,
    clinicId: clinicId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    patient: patient || undefined,
    analyteCode: view === 'released' ? analyte?.code : undefined,
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['results-search', query],
    queryFn: () =>
      labApi.results.search<ReleasedResultRow | InProgressResultRow>(query),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const formatDay = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    });
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  const rows = data?.view === view ? data.data : [];
  const showAnalyte = view === 'released' && !!analyte;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-white">{t('results.title')}</h1>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-sm text-gray-400">
              {t('results.count', { count: data.total })}
            </span>
          )}
          {canExportBilling && (
            <Link
              to="/billing/export"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm font-semibold text-white hover:bg-gray-700"
            >
              <Receipt size={14} />
              {t('billing.export.open')}
            </Link>
          )}
        </div>
      </div>

      {canSeeInProgress && (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist">
          {(['released', 'in_progress'] as ResultsView[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
                resetPage();
              }}
              className={`${TAB} ${view === v ? TAB_ACTIVE : TAB_INACTIVE}`}
            >
              {t(`results.tabs.${v}`)}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label
            htmlFor="results-clinic"
            className="mb-1 block text-xs font-medium text-gray-400"
          >
            {t('results.filters.clinic')}
          </label>
          <select
            id="results-clinic"
            value={clinicId}
            onChange={(e) => {
              setClinicId(e.target.value);
              resetPage();
            }}
            className="h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-white focus:border-cyan focus:outline-none"
          >
            <option value="">{t('results.filters.all_clinics')}</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-400">
            {t('results.filters.patient')}
          </span>
          <SearchInput
            value={patient}
            onChange={(v) => {
              setPatient(v.trim());
              resetPage();
            }}
            placeholder={t('results.filters.patient_placeholder')}
          />
        </div>
        {view === 'released' && (
          <div>
            <label
              htmlFor="results-analyte"
              className="mb-1 block text-xs font-medium text-gray-400"
            >
              {t('results.filters.analyte')}
            </label>
            <AnalytePicker
              value={analyte}
              onChange={(a) => {
                setAnalyte(a);
                resetPage();
              }}
            />
          </div>
        )}
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-400">
            {view === 'released'
              ? t('results.filters.released_date')
              : t('results.filters.order_date')}
          </span>
          <DateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(r) => {
              setDateFrom(r.dateFrom);
              setDateTo(r.dateTo);
              resetPage();
            }}
            label={t('results.filters.dates')}
          />
          {data?.dateFrom && !dateFrom && !dateTo && (
            <p className="mt-1 text-xs text-gray-500">
              {t('results.filters.default_range', {
                from: formatDay(data.dateFrom),
                to: formatDay(data.dateTo ?? data.dateFrom),
              })}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {apiMessage(error)}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-gray-800 bg-gray-900"
            />
          ))}
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {t('results.empty')}
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <div
          className={`overflow-x-auto rounded-xl border border-gray-800 bg-gray-900 ${
            isFetching ? 'opacity-70' : ''
          }`}
        >
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {view === 'released' && <th className="w-8 px-3 py-3" />}
                <th className="px-3 py-3 font-medium">
                  {view === 'released'
                    ? t('results.columns.released_at')
                    : t('results.columns.ordered_at')}
                </th>
                <th className="px-3 py-3 font-medium">
                  {t('results.columns.clinic')}
                </th>
                <th className="px-3 py-3 font-medium">
                  {t('results.columns.patient')}
                </th>
                <th className="px-3 py-3 font-medium">
                  {t('results.columns.test')}
                </th>
                {showAnalyte && (
                  <th className="px-3 py-3 font-medium">{analyte?.name}</th>
                )}
                {view === 'in_progress' && (
                  <th className="px-3 py-3 font-medium">
                    {t('results.columns.status')}
                  </th>
                )}
                <th className="px-3 py-3 font-medium">
                  {t('results.columns.requisition')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {view === 'released'
                ? (rows as ReleasedResultRow[]).map((r) => {
                    const expanded = expandedId === r.id;
                    return (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : r.id)}
                          aria-expanded={expanded}
                          className="cursor-pointer hover:bg-gray-800/50"
                        >
                          <td className="px-3 py-3 text-gray-500">
                            {expanded ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-gray-300">
                            {formatDate(r.releasedAt)}
                          </td>
                          <td className="px-3 py-3 text-gray-300">
                            {r.clinicName}
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-white">
                              {r.patientName}{' '}
                              <span className="text-xs text-gray-500">
                                (
                                {t(`species.${r.patientSpecies}`, {
                                  defaultValue: r.patientSpecies,
                                })}
                                )
                              </span>
                            </p>
                            <p className="text-xs text-gray-500">
                              {r.ownerName}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-gray-300">
                            {r.testName}
                            {r.amended && (
                              <span className="ml-2 rounded-full bg-blue-400/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                                {t('results.amended')}
                              </span>
                            )}
                          </td>
                          {showAnalyte && (
                            <td
                              className={`whitespace-nowrap px-3 py-3 font-medium ${flagClass(
                                r.analyte?.flag ?? null
                              )}`}
                            >
                              {r.analyte ? displayResultValue(r.analyte) : '—'}
                              {r.analyte?.unit && (
                                <span className="ml-1 text-xs text-gray-500">
                                  {r.analyte.unit}
                                </span>
                              )}
                              {flagLabel(r.analyte?.flag ?? null) && (
                                <span className="ml-1 text-xs">
                                  {flagLabel(r.analyte?.flag ?? null)}
                                </span>
                              )}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-400">
                            {r.requisitionNumber}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={showAnalyte ? 7 : 6} className="p-0">
                              <ReleasedResultDetail
                                orderId={r.orderId}
                                requisitionNumber={r.requisitionNumber}
                                highlightCode={analyte?.code}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                : (rows as InProgressResultRow[]).map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-300">
                        {formatDate(r.orderedAt)}
                      </td>
                      <td className="px-3 py-3 text-gray-300">
                        {r.clinicName}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-white">
                          {r.patientName}{' '}
                          <span className="text-xs text-gray-500">
                            (
                            {t(`species.${r.patientSpecies}`, {
                              defaultValue: r.patientSpecies,
                            })}
                            )
                          </span>
                        </p>
                        <p className="text-xs text-gray-500">{r.ownerName}</p>
                      </td>
                      <td className="px-3 py-3 text-gray-300">{r.testName}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} size="sm" />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs">
                        {/* Consulta never enters the order workspace */}
                        {isResultsViewer ? (
                          <span className="text-gray-400">
                            {r.requisitionNumber}
                          </span>
                        ) : (
                          <Link
                            to={`/orders/${r.orderId}`}
                            className="text-cyan hover:underline"
                          >
                            {r.requisitionNumber}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-4">
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
            onPageChange={(p) => {
              setPage(p);
              setExpandedId(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
