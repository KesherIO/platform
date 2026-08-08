import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { History, ArrowLeft, ChevronDown, X } from 'lucide-react';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { DateRangeFilter } from '../../shared/components/DateRangeFilter';
import { useToast } from '../../shared/components/ToastProvider';
import { AssignMessengerModal } from './AssignMessengerModal';
import type { MessengerInfo, PickupSummary } from '../../types/lab.types';

// Shared focus-visible ring so every toolbar control gets a keyboard-only
// focus outline (no ring on mouse click) — matches ConfirmDialog/IconActionButton.
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950';
// Shared sizing so status tabs, the messenger control, and the date-range
// control all read as one toolbar — same height/border/typography.
const TOOLBAR_TAB = `flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition ${FOCUS_RING}`;
const TOOLBAR_TAB_ACTIVE = 'border-cyan/30 bg-cyan/10 text-cyan';
const TOOLBAR_TAB_INACTIVE =
  'border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white';

const PAGE_SIZE = 20;
const HISTORY_STATUSES = 'RECEIVED_AT_LAB,CANCELLED,FAILED';

const PRIORITY_COLORS: Record<string, string> = {
  STAT: 'text-red-400',
  URGENT: 'text-orange-400',
  ROUTINE: 'text-gray-400',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWaitingSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function CollectionsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [pickups, setPickups] = useState<PickupSummary[]>([]);
  const [messengers, setMessengers] = useState<MessengerInfo[]>([]);
  const [historyMode, setHistoryMode] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(
    undefined
  );
  const [messengerFilter, setMessengerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigningPickupId, setAssigningPickupId] = useState<string | null>(
    null
  );
  const [receivingId, setReceivingId] = useState<string | null>(null);

  // Active queue tabs rely on the API's default scope (no status = active
  // only) so completed/cancelled pickups never mix into the daily queue.
  // History is a separate mode the lab has to explicitly ask for.
  const ACTIVE_TABS = [
    { label: t('collections.filter.all'), value: undefined },
    { label: t('collections.filter.unassigned'), value: 'REQUESTED' },
    {
      label: t('collections.filter.assigned'),
      value: 'ASSIGNED,NOTIFIED,ACCEPTED',
    },
    {
      label: t('collections.filter.in_transit'),
      value: 'COLLECTED,IN_TRANSIT',
    },
  ];

  const HISTORY_TABS = [
    { label: t('collections.filter.all_history'), value: HISTORY_STATUSES },
    { label: t('collections.filter.delivered'), value: 'RECEIVED_AT_LAB' },
    { label: t('collections.filter.cancelled'), value: 'CANCELLED,FAILED' },
  ];

  const FILTER_TABS = historyMode ? HISTORY_TABS : ACTIVE_TABS;

  const toggleHistoryMode = () => {
    setHistoryMode((prev) => !prev);
    setActiveFilter(historyMode ? undefined : HISTORY_STATUSES);
    // Date range only makes sense in History — the active queue is current
    // work, not a time-bounded search — so drop it when leaving History.
    if (historyMode) {
      setDateFrom('');
      setDateTo('');
    }
    setPage(1);
  };

  const load = useCallback(() => {
    let ignore = false;
    if (pickups.length === 0) setLoading(true);
    setFiltering(true);
    setError(null);
    labApi.pickups
      .list({
        status: activeFilter,
        search: search || undefined,
        messengerId: messengerFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        if (ignore) return;
        setPickups(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err: Error) => {
        if (ignore) return;
        setError(err.message);
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
          setFiltering(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [activeFilter, search, messengerFilter, dateFrom, dateTo, page]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    labApi.messengers
      .list()
      .then(setMessengers)
      .catch(() => undefined);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleFilterChange = (status: string | undefined) => {
    setActiveFilter(status);
    setPage(1);
  };

  const handleMessengerFilterChange = (value: string) => {
    setMessengerFilter(value);
    setPage(1);
  };

  const handleDateRangeChange = (range: {
    dateFrom: string;
    dateTo: string;
  }) => {
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    setPage(1);
  };

  const messengerFilterActive = Boolean(messengerFilter);
  const dateFilterActive = Boolean(dateFrom || dateTo);
  const activeSecondaryFilterCount =
    Number(messengerFilterActive) + Number(dateFilterActive);
  const hasAnySecondaryFilter = activeSecondaryFilterCount > 0;

  const clearExtraFilters = () => {
    setMessengerFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleConfirmReceived = async (pickupId: string) => {
    setReceivingId(pickupId);
    try {
      await labApi.pickups.received(pickupId);
      toast.success(t('collections.received_success'));
      load();
    } catch (err) {
      toast.error(
        `${t('collections.errors.received')} ${(err as Error).message}`
      );
    } finally {
      setReceivingId(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {historyMode
              ? t('collections.history_title')
              : t('collections.title')}
          </h1>
          {!loading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {total} {t('collections.subtitle')}
            </p>
          )}
        </div>
        <button
          onClick={toggleHistoryMode}
          className={`flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white ${FOCUS_RING}`}
        >
          {historyMode ? (
            <>
              <ArrowLeft size={16} />
              {t('collections.back_to_queue')}
            </>
          ) : (
            <>
              <History size={16} />
              {t('collections.view_history')}
            </>
          )}
        </button>
      </div>

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder={t('collections.search_placeholder')}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.label}
              onClick={() => handleFilterChange(tab.value)}
              className={`${TOOLBAR_TAB} ${
                activeFilter === tab.value
                  ? TOOLBAR_TAB_ACTIVE
                  : TOOLBAR_TAB_INACTIVE
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select
              value={messengerFilter}
              onChange={(e) => handleMessengerFilterChange(e.target.value)}
              aria-label={t('collections.all_messengers')}
              className={`h-9 appearance-none rounded-lg border pl-3 text-sm transition ${FOCUS_RING} ${
                messengerFilterActive
                  ? 'border-cyan/30 bg-cyan/10 pr-12 text-cyan'
                  : 'border-gray-700 bg-gray-900 pr-8 text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <option value="">{t('collections.all_messengers')}</option>
              {messengers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {[m.firstName, m.lastName].filter(Boolean).join(' ') ||
                    m.userId}
                </option>
              ))}
            </select>

            {messengerFilterActive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMessengerFilterChange('');
                }}
                aria-label={t('collections.clear_messenger')}
                className={`absolute right-6 top-1/2 -translate-y-1/2 rounded p-0.5 text-cyan hover:opacity-75 ${FOCUS_RING}`}
              >
                <X size={12} />
              </button>
            )}

            <ChevronDown
              size={14}
              className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${
                messengerFilterActive ? 'text-cyan' : 'text-gray-500'
              }`}
            />
          </div>

          {historyMode && (
            <DateRangeFilter
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={handleDateRangeChange}
              label={t('collections.date_range')}
            />
          )}

          {activeSecondaryFilterCount >= 2 && (
            <button
              onClick={clearExtraFilters}
              className={`h-9 rounded px-2 text-sm text-gray-400 underline hover:text-white ${FOCUS_RING}`}
            >
              {t('collections.clear_filters')}
            </button>
          )}
        </div>
      </div>

      {loading && pickups.length === 0 && (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-4 py-2.5"
            >
              <div className="space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-gray-800" />
                <div className="h-4 w-40 animate-pulse rounded bg-gray-700" />
                <div className="h-3 w-32 animate-pulse rounded bg-gray-800" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-gray-700" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {t('collections.errors.load')} {error}
        </div>
      )}

      {!loading && !error && pickups.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {search || hasAnySecondaryFilter
            ? t('common.no_results')
            : t('collections.empty')}
        </div>
      )}

      {!error && pickups.length > 0 && (
        <div
          className={`transition-opacity ${
            filtering ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="space-y-1.5">
            {pickups.map((pickup) => (
              <div
                key={pickup.id}
                className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-2.5 transition hover:border-gray-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <Link
                    to={`/orders/${pickup.orderId}`}
                    className="min-w-0 flex-1 space-y-0.5"
                  >
                    <p className="font-mono text-xs text-gray-500">
                      {pickup.requisitionNumber}
                    </p>
                    <p className="font-semibold text-white">
                      {pickup.clinicName}
                      {pickup.patientName && (
                        <span className="font-normal text-gray-400">
                          {' · '}
                          {pickup.patientName}
                        </span>
                      )}
                    </p>
                    {(pickup.pickupAddress || pickup.pickupContactName) && (
                      <p className="truncate text-xs text-gray-400">
                        {[
                          pickup.pickupAddress &&
                            `${t('collections.address')} ${
                              pickup.pickupAddress
                            }`,
                          pickup.pickupContactName,
                          pickup.pickupContactPhone,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      {t('collections.messenger')}{' '}
                      {pickup.messengerName
                        ? `${pickup.messengerName}${
                            pickup.messengerPhone
                              ? ` · ${pickup.messengerPhone}`
                              : ''
                          }`
                        : t('collections.unassigned')}
                    </p>
                  </Link>

                  <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          PRIORITY_COLORS[pickup.priority] ?? ''
                        }`}
                      >
                        {t(`priority.${pickup.priority}`, {
                          defaultValue: pickup.priority,
                        })}
                      </span>
                      <StatusBadge status={pickup.status} size="sm" />
                    </div>
                    <p className="text-xs text-gray-500">
                      {t('collections.waiting_since')}{' '}
                      {formatWaitingSince(pickup.createdAt)}
                      {' · '}
                      {formatTimestamp(pickup.createdAt)}
                    </p>

                    {pickup.status === 'REQUESTED' && (
                      <button
                        onClick={() => setAssigningPickupId(pickup.id)}
                        className="rounded-lg bg-cyan px-3 py-1 text-xs font-semibold text-gray-950 hover:opacity-90"
                      >
                        {t('collections.assign')}
                      </button>
                    )}
                    {pickup.status === 'IN_TRANSIT' && (
                      <button
                        onClick={() => handleConfirmReceived(pickup.id)}
                        disabled={receivingId === pickup.id}
                        className="rounded-lg bg-cyan px-3 py-1 text-xs font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                      >
                        {receivingId === pickup.id
                          ? '...'
                          : t('collections.confirm_received')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      )}

      {assigningPickupId && (
        <AssignMessengerModal
          pickupId={assigningPickupId}
          onClose={() => setAssigningPickupId(null)}
          onAssigned={() => {
            setAssigningPickupId(null);
            toast.success(t('collections.assigned_success'));
            load();
          }}
        />
      )}
    </div>
  );
}
