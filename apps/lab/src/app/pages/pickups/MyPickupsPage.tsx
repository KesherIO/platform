import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PackageCheck, AlertTriangle, History, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import { usePushSubscription } from './usePushSubscription';
import type { PickupSummary, PickupProblemReason } from '../../types/lab.types';

const HISTORY_STATUSES = 'RECEIVED_AT_LAB,CANCELLED,FAILED';

const PROBLEM_REASONS: PickupProblemReason[] = [
  'CLINIC_CLOSED',
  'SAMPLE_NOT_READY',
  'INCORRECT_ADDRESS',
  'UNABLE_TO_CONTACT',
  'OTHER',
];

const POLL_MS = 60_000;

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MyPickupsPage() {
  const { t } = useTranslation();
  const { canPerformPickups } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();

  usePushSubscription(canPerformPickups);

  const [pickups, setPickups] = useState<PickupSummary[]>([]);
  const [historyMode, setHistoryMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problemPickupId, setProblemPickupId] = useState<string | null>(null);
  const [problemReason, setProblemReason] =
    useState<PickupProblemReason>('CLINIC_CLOSED');
  const [problemDetails, setProblemDetails] = useState('');

  const load = useCallback(
    (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError(null);
      labApi.pickups
        .myPickups(historyMode ? { status: HISTORY_STATUSES } : undefined)
        .then(setPickups)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    },
    [historyMode]
  );

  // New assignments/status changes can arrive while this page is already
  // open (e.g. admin assigns another pickup, or Pedro accepted on another
  // device) — poll so the list doesn't go stale relative to the nav badge,
  // which polls independently in Layout. History view is static, no need
  // to poll it.
  useEffect(() => {
    load();
    if (historyMode) return;
    const interval = setInterval(() => load(false), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, historyMode]);

  const handleAccept = async (id: string) => {
    setBusyId(id);
    try {
      await labApi.pickups.accept(id);
      load(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCollected = async (id: string) => {
    try {
      const confirmed = await confirm({
        title: t('my_pickups.collected_confirm_title'),
        message: t('my_pickups.collected_confirm_message'),
        confirmLabel: t('my_pickups.collected'),
        icon: PackageCheck,
        onConfirm: async () => {
          setBusyId(id);
          await labApi.pickups.collected(id);
        },
      });
      if (confirmed) load(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const submitProblem = async () => {
    if (!problemPickupId) return;
    setBusyId(problemPickupId);
    try {
      await labApi.pickups.reportProblem(
        problemPickupId,
        problemReason,
        problemReason === 'OTHER' ? problemDetails : undefined
      );
      toast.success(t('my_pickups.problem_submitted'));
      setProblemPickupId(null);
      setProblemDetails('');
      setProblemReason('CLINIC_CLOSED');
      load(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">
          {historyMode ? t('my_pickups.history_title') : t('nav.my_pickups')}
        </h1>
        <button
          onClick={() => setHistoryMode((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          {historyMode ? (
            <>
              <ArrowLeft size={16} />
              {t('my_pickups.back_to_active')}
            </>
          ) : (
            <>
              <History size={16} />
              {t('my_pickups.view_history')}
            </>
          )}
        </button>
      </div>

      {loading && (
        <div className="mt-6 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl bg-gray-800"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && pickups.length === 0 && (
        <div className="mt-10 py-16 text-center text-gray-500">
          {historyMode ? t('my_pickups.history_empty') : t('my_pickups.empty')}
        </div>
      )}

      {!loading && !error && pickups.length > 0 && (
        <div className="mt-6 space-y-3">
          {pickups.map((pickup) => (
            <div
              key={pickup.id}
              className="rounded-xl border border-gray-800 bg-gray-900 p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-xs text-gray-500">
                    {pickup.requisitionNumber}
                  </p>
                  <p className="mt-0.5 font-semibold text-white">
                    {pickup.clinicName}
                  </p>
                </div>
                <StatusBadge status={pickup.status} size="sm" />
              </div>

              {pickup.pickupAddress && (
                <p className="mt-2 text-sm text-gray-300">
                  {t('my_pickups.address')} {pickup.pickupAddress}{' '}
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(
                      pickup.pickupAddress
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan hover:underline"
                  >
                    {t('my_pickups.open_maps')}
                  </a>
                </p>
              )}
              {pickup.pickupContactName && (
                <p className="text-sm text-gray-400">
                  {t('my_pickups.contact')} {pickup.pickupContactName}
                  {pickup.pickupContactPhone && (
                    <>
                      {' · '}
                      <a
                        href={`tel:${pickup.pickupContactPhone}`}
                        className="text-cyan hover:underline"
                      >
                        {pickup.pickupContactPhone}
                      </a>
                    </>
                  )}
                </p>
              )}
              {pickup.pickupInstructions && (
                <p className="mt-2 text-sm text-gray-400">
                  {t('my_pickups.instructions')} {pickup.pickupInstructions}
                </p>
              )}
              {pickup.requestedPickupTime && (
                <p className="mt-1 text-xs text-gray-500">
                  {t('my_pickups.requested_time')}{' '}
                  {formatTimestamp(pickup.requestedPickupTime)}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {pickup.status === 'NOTIFIED' && (
                  <button
                    onClick={() => handleAccept(pickup.id)}
                    disabled={busyId === pickup.id}
                    className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                  >
                    {busyId === pickup.id ? '...' : t('my_pickups.accept')}
                  </button>
                )}
                {pickup.status === 'ACCEPTED' && (
                  <>
                    <button
                      onClick={() => handleCollected(pickup.id)}
                      disabled={busyId === pickup.id}
                      className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                    >
                      {busyId === pickup.id ? '...' : t('my_pickups.collected')}
                    </button>
                    <button
                      onClick={() => setProblemPickupId(pickup.id)}
                      disabled={busyId === pickup.id}
                      className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                    >
                      {t('my_pickups.report_problem')}
                    </button>
                  </>
                )}
                {(pickup.status === 'COLLECTED' ||
                  pickup.status === 'IN_TRANSIT') && (
                  <p className="text-sm text-gray-400">
                    {t('my_pickups.waiting_for_receipt')}
                  </p>
                )}
                {pickup.status === 'RECEIVED_AT_LAB' && (
                  <p className="text-sm text-emerald-400">
                    {t('my_pickups.completed')}
                  </p>
                )}
                {(pickup.status === 'CANCELLED' ||
                  pickup.status === 'FAILED') && (
                  <p className="text-sm text-gray-500">
                    {t('my_pickups.cancelled')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {problemPickupId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setProblemPickupId(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-orange-400" />
              <h2 className="text-sm font-semibold text-white">
                {t('my_pickups.report_problem')}
              </h2>
            </div>

            <select
              value={problemReason}
              onChange={(e) =>
                setProblemReason(e.target.value as PickupProblemReason)
              }
              className="mt-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            >
              {PROBLEM_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`my_pickups.problem_reasons.${reason}`)}
                </option>
              ))}
            </select>

            {problemReason === 'OTHER' && (
              <textarea
                value={problemDetails}
                onChange={(e) => setProblemDetails(e.target.value)}
                rows={3}
                className="mt-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setProblemPickupId(null)}
                disabled={busyId === problemPickupId}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={submitProblem}
                disabled={busyId === problemPickupId}
                className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
