import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import type { LabOrderDetail } from '../../types/lab.types';

const STATUS_TRANSITIONS: Record<string, { labelKey: string; next: string }[]> =
  {
    PENDING: [
      { labelKey: 'orders.actions.mark_received', next: 'RECEIVED_BY_LAB' },
    ],
    READY_FOR_PICKUP: [
      { labelKey: 'orders.actions.mark_received', next: 'RECEIVED_BY_LAB' },
    ],
    COLLECTED: [
      { labelKey: 'orders.actions.mark_received', next: 'RECEIVED_BY_LAB' },
    ],
    RECEIVED_BY_LAB: [
      { labelKey: 'orders.actions.start_processing', next: 'PROCESSING' },
    ],
    PROCESSING: [
      { labelKey: 'orders.actions.mark_completed', next: 'COMPLETED' },
    ],
    COMPLETED: [],
    CANCELLED: [],
  };

export function OrderWorkspacePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { t } = useTranslation();
  const [order, setOrder] = useState<LabOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = await labApi.orders.getById(orderId);
      setOrder(data as LabOrderDetail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const initTests = async () => {
    if (!orderId) return;
    await labApi.orders.initOrderedTests(orderId);
    await loadOrder();
  };

  const transition = async (next: string) => {
    if (!orderId) return;
    setTransitioning(true);
    try {
      await labApi.orders.updateStatus(orderId, next);
      await loadOrder();
    } finally {
      setTransitioning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-6 text-red-400">
        {t('common.error_loading')}: {error}
      </div>
    );
  }

  const transitions = STATUS_TRANSITIONS[order.status] ?? [];
  const hasTests = order.orderedTests.length > 0;
  const c = order.case;

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to="/orders" className="text-sm text-gray-400 hover:text-white">
          {t('workspace.back')}
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="font-mono text-sm text-gray-400">
            {order.requisitionNumber}
          </p>
          <h1 className="mt-1 text-xl font-bold text-white">{c.patientName}</h1>
          <p className="text-sm text-gray-400">
            {t(`species.${c.patientSpecies}`, {
              defaultValue: c.patientSpecies,
            })}
            {c.patientBreed ? ` — ${c.patientBreed}` : ''}
            {c.patientAge ? ` · ${c.patientAge} ${c.patientAgeUnit}` : ''}
            {c.patientWeight ? ` · ${c.patientWeight} kg` : ''}
          </p>
          <p className="mt-0.5 text-sm text-gray-400">
            {t('orders.owner')} {c.ownerName}
            {c.ownerPhone ? ` · ${c.ownerPhone}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} />
          {transitions.map((tr) => (
            <button
              key={tr.next}
              onClick={() => transition(tr.next)}
              disabled={transitioning}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {t(tr.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-4">
          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-300">
              {t('workspace.clinic')}
            </h2>
            <p className="text-sm text-white">{order.clinicName}</p>
            {order.clinicNotes && (
              <p className="mt-2 text-sm text-gray-400">{order.clinicNotes}</p>
            )}
          </section>

          {c.symptoms && (
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-300">
                {t('workspace.symptoms')}
              </h2>
              <p className="text-sm text-gray-300">{c.symptoms}</p>
            </section>
          )}

          {(order.sampleType || order.sampleNotes) && (
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-300">
                {t('workspace.sample')}
              </h2>
              {order.sampleType && (
                <p className="text-sm text-white">{order.sampleType}</p>
              )}
              {order.sampleNotes && (
                <p className="mt-1 text-sm text-gray-400">
                  {order.sampleNotes}
                </p>
              )}
            </section>
          )}
        </div>

        <div className="col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              {t('workspace.ordered_tests')}
            </h2>
            {!hasTests && order.status !== 'PENDING' && (
              <button
                onClick={initTests}
                className="rounded-lg border border-cyan/50 px-3 py-1.5 text-xs text-cyan hover:bg-cyan/10"
              >
                {t('workspace.init_tests')}
              </button>
            )}
            {hasTests && order.resultReport && (
              <Link
                to={`/orders/${order.id}/review`}
                className="rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                {t('workspace.review_release')}
              </Link>
            )}
          </div>

          <div className="space-y-2">
            {hasTests ? (
              order.orderedTests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-white">
                      {test.catalogItemName}
                    </p>
                    {test.catalogItemCode && (
                      <p className="font-mono text-xs text-gray-500">
                        {test.catalogItemCode}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={test.status} size="sm" />
                    {test.status !== 'COMPLETED' &&
                      test.status !== 'CANCELLED' && (
                        <Link
                          to={`/orders/${order.id}/tests/${test.id}/results`}
                          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                        >
                          {t('workspace.enter_results')}
                        </Link>
                      )}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-8 text-center text-sm text-gray-500">
                {t('workspace.tests_init_hint')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
