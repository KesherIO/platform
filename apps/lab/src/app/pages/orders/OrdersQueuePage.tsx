import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { DateRangeFilter } from '../../shared/components/DateRangeFilter';
import type { LabOrderSummary } from '../../types/lab.types';

// Shared sizing so status tabs and the date-range control share one height.
const TOOLBAR_TAB =
  'flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950';
const TOOLBAR_TAB_ACTIVE = 'border-cyan/30 bg-cyan/10 text-cyan';
const TOOLBAR_TAB_INACTIVE =
  'border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white';

const PAGE_SIZE = 20;

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

export function OrdersQueuePage() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<LabOrderSummary[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(
    undefined
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const FILTER_TABS = [
    { label: t('orders.filter.all'), value: undefined },
    {
      label: t('orders.filter.awaiting_sample'),
      value: 'PENDING,READY_FOR_PICKUP',
    },
    { label: t('orders.filter.in_transit'), value: 'COLLECTED' },
    { label: t('orders.filter.received'), value: 'RECEIVED_BY_LAB' },
    { label: t('orders.filter.processing'), value: 'PROCESSING' },
    { label: t('orders.filter.completed'), value: 'COMPLETED' },
  ];

  useEffect(() => {
    let ignore = false;
    if (orders.length === 0) setLoading(true);
    setFiltering(true);
    setError(null);
    labApi.orders
      .list({
        status: activeFilter,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        if (ignore) return;
        setOrders(res.data);
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
  }, [activeFilter, search, dateFrom, dateTo, page]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleFilterChange = (status: string | undefined) => {
    setActiveFilter(status);
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

  const hasDateFilter = Boolean(dateFrom || dateTo);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('orders.title')}</h1>
        <span className="text-sm text-gray-400">
          {total} {t('common.orders')}
        </span>
      </div>

      <div className="mb-4">
        <SearchInput value={search} onChange={handleSearchChange} />
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
          <DateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={handleDateRangeChange}
            label={t('orders.date_range')}
          />
        </div>
      </div>

      {loading && orders.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
            >
              <div className="space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-gray-800" />
                <div className="h-4 w-40 animate-pulse rounded bg-gray-700" />
                <div className="h-3 w-32 animate-pulse rounded bg-gray-800" />
              </div>
              <div className="flex items-center gap-4">
                <div className="space-y-2 text-right">
                  <div className="ml-auto h-3 w-28 animate-pulse rounded bg-gray-800" />
                  <div className="ml-auto h-3 w-16 animate-pulse rounded bg-gray-800" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {t('orders.error')} {error}
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {search || hasDateFilter ? t('common.no_results') : t('orders.empty')}
        </div>
      )}

      {!error && orders.length > 0 && (
        <div
          className={`transition-opacity ${
            filtering ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="space-y-2">
            {orders.map((order) => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-gray-700 hover:bg-gray-800"
              >
                <div>
                  <p className="font-mono text-xs text-gray-500">
                    {order.requisitionNumber}
                  </p>
                  <p className="mt-0.5 font-semibold text-white">
                    {order.patientName}{' '}
                    <span className="text-sm font-normal text-gray-400">
                      (
                      {t(`species.${order.patientSpecies}`, {
                        defaultValue: order.patientSpecies,
                      })}
                      )
                    </span>
                  </p>
                  <p className="text-sm text-gray-400">
                    {t('orders.owner')} {order.ownerName}
                  </p>
                  <p className="text-xs text-gray-500">{order.clinicName}</p>
                </div>

                <div className="flex items-center gap-4 text-right">
                  <div>
                    <p className="text-xs text-gray-500">
                      {t('orders.created')} {formatTimestamp(order.createdAt)}
                    </p>
                    {order.receivedByLabAt && (
                      <p className="text-xs text-gray-500">
                        {t('orders.received')}{' '}
                        {formatTimestamp(order.receivedByLabAt)}
                      </p>
                    )}
                    <p
                      className={`mt-0.5 text-xs font-semibold ${
                        PRIORITY_COLORS[order.priority] ?? ''
                      }`}
                    >
                      {t(`priority.${order.priority}`, {
                        defaultValue: order.priority,
                      })}
                    </p>
                  </div>
                  <StatusBadge status={order.status} size="sm" />
                </div>
              </Link>
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
    </div>
  );
}
