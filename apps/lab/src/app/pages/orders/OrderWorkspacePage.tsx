import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import type { OrderedTest } from '../../types/lab.types';

const TECHNICAL_EVENT_TYPES = new Set([
  'NOTIFICATION_SENT',
  'NOTIFICATION_FAILED',
]);

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_TRANSITIONS: Record<string, { labelKey: string; next: string }[]> =
  {
    PENDING: [],
    READY_FOR_PICKUP: [],
    COLLECTED: [],
    RECEIVED_BY_LAB: [
      { labelKey: 'orders.actions.start_processing', next: 'PROCESSING' },
    ],
    PROCESSING: [
      { labelKey: 'orders.actions.mark_completed', next: 'COMPLETED' },
    ],
    COMPLETED: [],
    CANCELLED: [],
  };

type TestGroup =
  | { kind: 'standalone'; test: OrderedTest }
  | { kind: 'package'; originName: string; tests: OrderedTest[] };

function buildTestGroups(tests: OrderedTest[]): TestGroup[] {
  const packageMap = new Map<
    string,
    { originName: string; tests: OrderedTest[] }
  >();
  const standaloneTests: OrderedTest[] = [];

  for (const test of tests) {
    const packageSources = test.sources.filter(
      (s) => s.sourceType === 'PACKAGE'
    );
    if (packageSources.length > 0) {
      const firstPkg = packageSources[0];
      const key = firstPkg.originCatalogItemId;
      const group = packageMap.get(key);
      if (group) {
        group.tests.push(test);
      } else {
        packageMap.set(key, { originName: firstPkg.originName, tests: [test] });
      }
    } else {
      standaloneTests.push(test);
    }
  }

  const groups: TestGroup[] = [];
  const usedPackageIds = new Set<string>();

  for (const test of tests) {
    const packageSources = test.sources.filter(
      (s) => s.sourceType === 'PACKAGE'
    );
    if (packageSources.length > 0) {
      const key = packageSources[0].originCatalogItemId;
      if (!usedPackageIds.has(key)) {
        usedPackageIds.add(key);
        groups.push({ kind: 'package', ...packageMap.get(key)! });
      }
    } else {
      groups.push({ kind: 'standalone', test });
    }
  }

  return groups;
}

function getAlsoDirectNote(test: OrderedTest): boolean {
  return (
    test.sources.some((s) => s.sourceType === 'PACKAGE') &&
    test.sources.some((s) => s.sourceType === 'DIRECT')
  );
}

function getOtherPackageNames(
  test: OrderedTest,
  primaryOriginId: string
): string[] {
  return test.sources
    .filter(
      (s) =>
        s.sourceType === 'PACKAGE' && s.originCatalogItemId !== primaryOriginId
    )
    .map((s) => s.originName);
}

export function OrderWorkspacePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [transitioning, setTransitioning] = useState(false);
  const [receivingTestId, setReceivingTestId] = useState<string | null>(null);
  const [receivingAll, setReceivingAll] = useState(false);
  const [confirmingReceived, setConfirmingReceived] = useState(false);

  const {
    data: order,
    isLoading: loading,
    error: orderError,
  } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () =>
      labApi.orders.getById(orderId!) as Promise<
        import('../../types/lab.types').LabOrderDetail
      >,
    enabled: !!orderId,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['timeline', orderId],
    queryFn: () => labApi.timeline.forOrder(orderId!),
    enabled: !!orderId,
  });

  const error = orderError ? (orderError as Error).message : null;

  const invalidateOrder = () => {
    queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    queryClient.invalidateQueries({ queryKey: ['timeline', orderId] });
  };

  const confirmPickupReceived = async () => {
    if (!order?.pickup) return;
    setConfirmingReceived(true);
    try {
      await labApi.pickups.received(order.pickup.id);
      invalidateOrder();
    } finally {
      setConfirmingReceived(false);
    }
  };

  const initTests = async () => {
    if (!orderId) return;
    await labApi.orders.initOrderedTests(orderId);
    invalidateOrder();
  };

  const receiveTest = async (testId: string) => {
    setReceivingTestId(testId);
    try {
      await labApi.orderedTests.receive(testId);
      invalidateOrder();
    } finally {
      setReceivingTestId(null);
    }
  };

  const receiveAll = async () => {
    if (!orderId) return;
    setReceivingAll(true);
    try {
      await labApi.orders.receiveAll(orderId);
      invalidateOrder();
    } finally {
      setReceivingAll(false);
    }
  };

  const transition = async (next: string) => {
    if (!orderId) return;
    setTransitioning(true);
    try {
      await labApi.orders.updateStatus(orderId, next);
      invalidateOrder();
    } finally {
      setTransitioning(false);
    }
  };

  const testGroups = useMemo(
    () => (order ? buildTestGroups(order.orderedTests) : []),
    [order]
  );

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
  const isPreReceived = ['PENDING', 'READY_FOR_PICKUP', 'COLLECTED'].includes(
    order.status
  );
  const unreceived = order.orderedTests.filter((t) => !t.receivedAt);
  const hasUnreceived = unreceived.length > 0;

  const renderTestActions = (test: OrderedTest) => (
    <>
      {test.receivedAt ? (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          {t('workspace.sample_received')} · {formatTimestamp(test.receivedAt)}
        </span>
      ) : isPreReceived ? (
        <button
          onClick={() => receiveTest(test.id)}
          disabled={receivingTestId === test.id || receivingAll}
          className="rounded-lg border border-cyan/50 px-3 py-1.5 text-xs text-cyan hover:bg-cyan/10 disabled:opacity-50"
        >
          {receivingTestId === test.id
            ? '...'
            : t('orders.actions.mark_received_single')}
        </button>
      ) : (
        <span className="text-xs text-yellow-500">
          {t('workspace.sample_pending')}
        </span>
      )}
      <StatusBadge status={test.status} size="sm" />
      {test.receivedAt &&
        test.status !== 'COMPLETED' &&
        test.status !== 'CANCELLED' && (
          <Link
            to={`/orders/${order.id}/tests/${test.id}/results`}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
          >
            {t('workspace.enter_results')}
          </Link>
        )}
    </>
  );

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
            <p className="text-sm text-white">{order.tenant.name}</p>
            {order.tenant.email && (
              <p className="mt-1 text-sm text-gray-400">{order.tenant.email}</p>
            )}
            {order.tenant.phone && (
              <p className="text-sm text-gray-400">{order.tenant.phone}</p>
            )}
            {order.clinicNotes && (
              <p className="mt-2 text-sm text-gray-400">{order.clinicNotes}</p>
            )}
          </section>

          {order.pickup && (
            <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">
                  {t('pickup.status')}
                </h2>
                <StatusBadge status={order.pickup.status} size="sm" />
              </div>
              <div className="space-y-1.5 text-sm">
                {order.pickup.messenger && (
                  <p className="text-gray-400">
                    <span className="text-gray-500">
                      {t('pickup.assigned_messenger')}:
                    </span>{' '}
                    {[
                      order.pickup.messenger.firstName,
                      order.pickup.messenger.lastName,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    {order.pickup.messenger.phone
                      ? ` · ${order.pickup.messenger.phone}`
                      : ''}
                  </p>
                )}
                {order.pickup.assignedAt && (
                  <p className="text-gray-400">
                    <span className="text-gray-500">
                      {t('orders.created')}:
                    </span>{' '}
                    {formatTimestamp(order.pickup.assignedAt)}
                  </p>
                )}
                {order.pickup.acceptedAt && (
                  <p className="text-gray-400">
                    <span className="text-gray-500">
                      {t('timeline.PICKUP_ACCEPTED')}:
                    </span>{' '}
                    {formatTimestamp(order.pickup.acceptedAt)}
                  </p>
                )}
                {order.pickup.collectedAt && (
                  <p className="text-gray-400">
                    <span className="text-gray-500">
                      {t('timeline.SAMPLE_COLLECTED')}:
                    </span>{' '}
                    {formatTimestamp(order.pickup.collectedAt)}
                  </p>
                )}
                {order.pickup.receivedAt && (
                  <p className="text-gray-400">
                    <span className="text-gray-500">
                      {t('timeline.RECEIVED_AT_LAB')}:
                    </span>{' '}
                    {formatTimestamp(order.pickup.receivedAt)}
                  </p>
                )}
              </div>
              {order.pickup.status === 'IN_TRANSIT' && (
                <button
                  onClick={confirmPickupReceived}
                  disabled={confirmingReceived}
                  className="mt-3 w-full rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                >
                  {confirmingReceived
                    ? '...'
                    : t('collections.confirm_received')}
                </button>
              )}
            </section>
          )}

          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-300">
              {t('timeline.title')}
            </h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-500">
                <span className="text-gray-500">{t('orders.created')}:</span>{' '}
                {formatTimestamp(order.createdAt)}
              </p>
            ) : (
              <div className="space-y-2.5">
                {timeline.map((event) => {
                  const technical = TECHNICAL_EVENT_TYPES.has(event.eventType);
                  const rawReason = (event.metadata as { reason?: string })
                    ?.reason;
                  const reason = rawReason
                    ? t(`my_pickups.problem_reasons.${rawReason}`, {
                        defaultValue: rawReason,
                      })
                    : undefined;
                  return (
                    <div key={event.id} className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          technical ? 'bg-gray-600' : 'bg-cyan'
                        }`}
                      />
                      <div>
                        <p
                          className={
                            technical
                              ? 'text-xs text-gray-500'
                              : 'text-sm text-gray-300'
                          }
                        >
                          {t(`timeline.${event.eventType}`, {
                            defaultValue: event.description,
                            messenger: (
                              event.metadata as { messengerName?: string }
                            )?.messengerName,
                            reason,
                            channel: 'push',
                          })}
                        </p>
                        <p className="text-xs text-gray-600">
                          {event.actorName ? `${event.actorName} · ` : ''}
                          {formatTimestamp(event.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
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
            <div className="flex items-center gap-2">
              {isPreReceived && hasTests && hasUnreceived && (
                <button
                  onClick={receiveAll}
                  disabled={receivingAll}
                  className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                >
                  {receivingAll ? '...' : t('orders.actions.mark_all_received')}
                </button>
              )}
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
          </div>

          <div className="space-y-2">
            {hasTests ? (
              testGroups.map((group) =>
                group.kind === 'package' ? (
                  <div
                    key={`pkg-${
                      group.tests[0].sources.find(
                        (s) => s.sourceType === 'PACKAGE'
                      )!.originCatalogItemId
                    }`}
                    className="rounded-xl border border-gray-800 bg-gray-900"
                  >
                    <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2.5">
                      <span className="text-sm">📦</span>
                      <span className="text-sm font-semibold text-gray-300">
                        {group.originName}
                      </span>
                      <span className="text-xs text-gray-600">
                        ({group.tests.length})
                      </span>
                    </div>
                    <div className="divide-y divide-gray-800/50">
                      {group.tests.map((test) => {
                        const primaryOriginId = test.sources.find(
                          (s) => s.sourceType === 'PACKAGE'
                        )!.originCatalogItemId;
                        const alsoDirect = getAlsoDirectNote(test);
                        const otherPkgs = getOtherPackageNames(
                          test,
                          primaryOriginId
                        );
                        return (
                          <div
                            key={test.id}
                            className="flex items-center justify-between px-4 py-3"
                          >
                            <div>
                              <p className="font-medium text-white">
                                {test.catalogItemName}
                              </p>
                              <div className="flex items-center gap-2">
                                {test.catalogItemCode && (
                                  <span className="font-mono text-xs text-gray-500">
                                    {test.catalogItemCode}
                                  </span>
                                )}
                                {alsoDirect && (
                                  <span className="text-xs text-cyan/70">
                                    {t('workspace.also_direct')}
                                  </span>
                                )}
                                {otherPkgs.map((name) => (
                                  <span
                                    key={name}
                                    className="text-xs text-gray-500"
                                  >
                                    {t('workspace.also_in_package', { name })}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {renderTestActions(test)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div
                    key={group.test.id}
                    className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-white">
                        {group.test.catalogItemName}
                      </p>
                      {group.test.catalogItemCode && (
                        <p className="font-mono text-xs text-gray-500">
                          {group.test.catalogItemCode}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {renderTestActions(group.test)}
                    </div>
                  </div>
                )
              )
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
