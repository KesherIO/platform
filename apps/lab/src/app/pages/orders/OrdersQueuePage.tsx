import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import type { LabOrderSummary } from '../../types/lab.types';

const PRIORITY_COLORS: Record<string, string> = {
  STAT: 'text-red-400',
  URGENT: 'text-orange-400',
  ROUTINE: 'text-gray-400',
};

export function OrdersQueuePage() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<LabOrderSummary[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const FILTER_TABS = [
    { label: t('orders.filter.all'), value: undefined },
    { label: t('orders.filter.received'), value: 'RECEIVED_BY_LAB' },
    { label: t('orders.filter.processing'), value: 'PROCESSING' },
    { label: t('orders.filter.completed'), value: 'COMPLETED' },
  ];

  useEffect(() => {
    setLoading(true);
    setError(null);
    labApi.orders
      .list(activeFilter)
      .then((data) => setOrders(data as LabOrderSummary[]))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeFilter]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('orders.title')}</h1>
        <span className="text-sm text-gray-400">
          {orders.length} {t('common.orders')}
        </span>
      </div>

      <div className="mb-4 flex gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveFilter(tab.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeFilter === tab.value
                ? 'bg-cyan/10 text-cyan'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {t('orders.error')} {error}
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {t('orders.empty')}
        </div>
      )}

      {!loading && !error && orders.length > 0 && (
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
              </div>

              <div className="flex items-center gap-4 text-right">
                <div>
                  <p className="text-xs text-gray-500">{order.clinicName}</p>
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
                <StatusBadge status={order.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
