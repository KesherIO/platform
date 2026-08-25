import { Skeleton } from '../../shared/components/Skeleton';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { useToast } from '../../shared/components/ToastProvider';
import type { LabOrderDetail } from '../../types/lab.types';

type Analyte = {
  id: string;
  name: string;
  technique: string | null;
  valueType: string;
  unit: string | null;
  options: string[];
  referenceRange: { min?: number; max?: number; displayText: string } | null;
  isHeader: boolean;
  formula: string | null;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
};


function TestResultSection({
  orderId,
  testId,
}: {
  orderId: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const { data: session } = useQuery({
    queryKey: ['result-session', testId],
    queryFn: () => labApi.resultEntry.getSession(testId),
    staleTime: 30_000,
  });

  if (!session) {
    return (
      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const renderValue = (analyte: Analyte) => {
    if (analyte.isHeader) return null;
    const refRange = analyte.referenceRange;
    const numVal = analyte.numericValue;
    const isHigh =
      refRange?.max !== undefined && numVal !== null && numVal > refRange.max;
    const isLow =
      refRange?.min !== undefined && numVal !== null && numVal < refRange.min;
    const flagColor = isHigh
      ? 'text-red-400'
      : isLow
      ? 'text-blue-400'
      : 'text-gray-300';

    let displayVal: string | null = null;
    if (analyte.valueType === 'NUMERIC' || analyte.formula) {
      displayVal = numVal !== null ? String(numVal) : null;
    } else if (analyte.valueType === 'TEXT') {
      displayVal = analyte.textValue;
    } else if (analyte.valueType === 'SELECT') {
      displayVal = analyte.selectValue;
    } else if (analyte.valueType === 'BOOLEAN') {
      displayVal =
        analyte.booleanValue === true
          ? 'Positivo'
          : analyte.booleanValue === false
          ? 'Negativo'
          : null;
    }

    return (
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-gray-800/40 py-2 last:border-0">
        <div>
          <p className="text-sm text-gray-200">{analyte.name}</p>
          {analyte.technique && (
            <p className="text-xs text-gray-500">{analyte.technique}</p>
          )}
        </div>
        <span className={`text-sm font-medium ${flagColor}`}>
          {displayVal ?? <span className="text-gray-600">—</span>}
          {analyte.unit ? (
            <span className="ml-1 text-xs text-gray-500">{analyte.unit}</span>
          ) : null}
          {(isHigh || isLow) && (
            <span className="ml-1 text-xs">{isHigh ? '▲H' : '▼L'}</span>
          )}
        </span>
        <span className="text-right text-xs text-gray-600">
          {refRange?.displayText ?? ''}
        </span>
      </div>
    );
  };

  return (
    <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
        <div>
          <p className="font-medium text-white">{session.test.name}</p>
          {session.test.code && (
            <p className="font-mono text-xs text-gray-500">
              {session.test.code}
            </p>
          )}
        </div>
        <Link
          to={`/orders/${orderId}/tests/${testId}/results`}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
        >
          {t('review.edit_results')}
        </Link>
      </div>

      <div className="px-5 py-2">
        {session.sections.map((section, si) => (
          <div key={section.id ?? si} className="mb-3">
            {section.name && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {section.name}
              </p>
            )}
            {section.analytes.map((analyte) =>
              analyte.isHeader ? (
                <p
                  key={analyte.id}
                  className="py-1.5 text-sm font-semibold text-gray-200"
                >
                  {analyte.name}
                </p>
              ) : (
                <div key={analyte.id}>{renderValue(analyte)}</div>
              )
            )}
          </div>
        ))}

        {session.report?.observations && (
          <div className="mt-3 border-t border-gray-800/40 pt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('result_entry.observations')}
            </p>
            <p className="text-sm text-gray-300">
              {session.report.observations}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ReviewReleasePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: order, isLoading: loading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => labApi.orders.getById(orderId!) as Promise<LabOrderDetail>,
    enabled: !!orderId,
  });

  const releaseReport = async () => {
    if (!order?.resultReport?.id) return;
    try {
      await labApi.resultEntry.releaseReport(order.resultReport.id);
      await labApi.orders.updateStatus(orderId!, 'COMPLETED');
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['worklist-ready-count'] });
      toast.success(t('review.released_success'));
    } catch (e) {
      toast.error(`${t('review.release_error')} ${(e as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl">
        <Skeleton className="mb-6 h-4 w-24" />
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-10 w-44" />
        </div>
        {[1, 2].map((i) => (
          <div
            key={i}
            className="mb-4 rounded-xl border border-gray-800 bg-gray-900"
          >
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
            <div className="px-5 py-3 space-y-3">
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex items-center justify-between py-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!order) return null;

  const enteredTests = order.orderedTests.filter((t) =>
    ['RESULTS_ENTERED', 'IN_REVIEW'].includes(t.status)
  );
  const pendingTests = order.orderedTests.filter(
    (t) =>
      !['RESULTS_ENTERED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED'].includes(
        t.status
      )
  );

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-4">
        <Link
          to={`/orders/${order.id}`}
          className="text-sm text-gray-400 hover:text-white"
        >
          {t('review.back')}
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">
          {t('review.title', { patient: order.case.patientName })}
        </h1>
        {order.resultReport?.status === 'DRAFT' && (
          <button
            onClick={releaseReport}
            className="rounded-lg bg-purple px-5 py-2.5 font-semibold text-white hover:opacity-90"
          >
            {t('review.release_btn')}
          </button>
        )}
        {order.resultReport?.status === 'RELEASED' && (
          <span className="rounded-full bg-green-900/30 px-3 py-1 text-sm font-medium text-green-400">
            {t('review.already_released')}
          </span>
        )}
      </div>

      {pendingTests.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3">
          <p className="text-sm text-yellow-300">
            {t('review.pending_warning')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingTests.map((test) => (
              <span key={test.id} className="flex items-center gap-1.5">
                <span className="text-xs text-yellow-400">
                  {test.catalogItemName}
                </span>
                <StatusBadge status={test.status} size="sm" />
              </span>
            ))}
          </div>
        </div>
      )}

      {enteredTests.length > 0 ? (
        enteredTests.map((test) => (
          <TestResultSection
            key={test.id}
            orderId={order.id}
            testId={test.id}
          />
        ))
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-8 text-center text-sm text-gray-500">
          {t('review.no_report')}
        </div>
      )}
    </div>
  );
}
