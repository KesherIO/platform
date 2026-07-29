import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../shared/components/StatusBadge';
import type { ClientOrder } from '../../types/lab.types';

interface Props {
  orders: ClientOrder[];
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export function ClientOrdersCard({ orders }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">
        {t('clients.detail.orders_title')} ({orders.length})
      </h2>
      {orders.length === 0 ? (
        <p className="text-sm text-gray-500">{t('clients.detail.no_orders')}</p>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => navigate(`/orders/${o.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-800 px-3 py-2 text-left transition hover:border-gray-700"
            >
              <div>
                <p className="text-sm text-white">{o.requisitionNumber}</p>
                <p className="text-xs text-gray-400">
                  {o.patientName} · {formatDate(o.createdAt)}
                </p>
              </div>
              <StatusBadge status={o.status} size="sm" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
