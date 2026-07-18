import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import type { LabOrderDetail } from '../../types/lab.types';

export function ReviewReleasePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [order, setOrder] = useState<LabOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = await labApi.orders.getById(orderId);
      setOrder(data as LabOrderDetail);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const releaseReport = async () => {
    if (!order?.resultReport?.id) return;
    const { data } = await import('../../auth/supabase').then((m) =>
      m.supabase.auth.getSession()
    );
    const token = data.session?.access_token ?? '';

    const res = await fetch(`/api/results/${order.resultReport.id}/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      alert(`${t('review.release_error')} ${await res.text()}`);
      return;
    }

    await labApi.orders.updateStatus(orderId!, 'COMPLETED');
    navigate(`/orders/${orderId}`);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  if (!order) return null;

  const allCompleted = order.orderedTests.every(
    (t) => t.status === 'COMPLETED' || t.status === 'CANCELLED'
  );

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link
          to={`/orders/${order.id}`}
          className="text-sm text-gray-400 hover:text-white"
        >
          {t('review.back')}
        </Link>
      </div>

      <h1 className="mb-6 text-xl font-bold text-white">
        {t('review.title', { patient: order.case.patientName })}
      </h1>

      <section className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-300">
          {t('review.test_status')}
        </h2>
        <div className="space-y-2">
          {order.orderedTests.map((test) => (
            <div key={test.id} className="flex items-center justify-between">
              <span className="text-sm text-white">{test.catalogItemName}</span>
              <StatusBadge status={test.status} size="sm" />
            </div>
          ))}
        </div>
      </section>

      {order.resultReport ? (
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {t('review.result_report')}
          </h2>
          <div className="mb-4 flex items-center gap-3">
            <StatusBadge status={order.resultReport.status} />
            {order.resultReport.status === 'RELEASED' && (
              <span className="text-sm text-green-400">
                {t('review.already_released')}
              </span>
            )}
          </div>

          {order.resultReport.status === 'DRAFT' && (
            <>
              {!allCompleted && (
                <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3">
                  <p className="text-sm text-yellow-300">
                    {t('review.pending_warning')}
                  </p>
                </div>
              )}
              <button
                onClick={releaseReport}
                className="w-full rounded-lg bg-purple px-4 py-2.5 font-semibold text-white hover:opacity-90"
              >
                {t('review.release_btn')}
              </button>
            </>
          )}
        </section>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-8 text-center text-sm text-gray-500">
          {t('review.no_report')}
        </div>
      )}
    </div>
  );
}
