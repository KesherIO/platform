import { useState, useRef } from 'react';
import { Skeleton } from '../../shared/components/Skeleton';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { useToast } from '../../shared/components/ToastProvider';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useAuth } from '../../auth/AuthContext';
import type { LabOrderDetail, LabSigner } from '../../types/lab.types';

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

type ResultSession = {
  test: { id: string; name: string; code: string | null; status: string };
  sections: { id: string | null; name: string | null; analytes: Analyte[] }[];
  report: {
    id: string;
    observations: string | null;
    correctionNotes: string | null;
  } | null;
};

function TestResultSection({
  orderId,
  testId,
  session,
  readOnly,
}: {
  orderId: string;
  testId: string;
  session: ResultSession | undefined;
  readOnly: boolean;
}) {
  const { t } = useTranslation();

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
    } else if (analyte.valueType === 'LONG_TEXT') {
      displayVal = analyte.textValue;
    } else if (analyte.valueType === 'SELECT') {
      displayVal = analyte.selectValue;
    } else if (analyte.valueType === 'POSITIVE_NEGATIVE') {
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
        <span
          className={`text-sm font-medium ${flagColor}`}
          style={
            analyte.valueType === 'LONG_TEXT'
              ? { whiteSpace: 'pre-wrap' }
              : undefined
          }
        >
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
        {!readOnly && (
          <Link
            to={`/orders/${orderId}/tests/${testId}/results`}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
          >
            {t('review.edit_results')}
          </Link>
        )}
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

function ReviewerPanel({
  selectedSignerId,
  setSelectedSignerId,
  selectedAnalystId,
  setSelectedAnalystId,
  reviewNotes,
  setReviewNotes,
  needsAttention,
}: {
  selectedSignerId: string;
  setSelectedSignerId: (v: string) => void;
  selectedAnalystId: string;
  setSelectedAnalystId: (v: string) => void;
  reviewNotes: string;
  setReviewNotes: (v: string) => void;
  needsAttention?: boolean;
}) {
  const { t } = useTranslation();

  const { data: signers, isLoading: loadingSigners } = useQuery({
    queryKey: ['reviewer-signers'],
    queryFn: () => labApi.review.getReviewerSigners(),
    staleTime: 0,
  });

  const { data: analysts, isLoading: loadingAnalysts } = useQuery({
    queryKey: ['analyst-signers'],
    queryFn: () => labApi.review.getAnalystSigners(),
    staleTime: 0,
  });

  if (loadingSigners || loadingAnalysts) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    );
  }

  if (!signers?.length) {
    return (
      <div className="rounded-xl border border-yellow-800/50 bg-yellow-900/20 px-5 py-4">
        <p className="text-sm text-yellow-300">
          {t('review.no_reviewer_signers')}
        </p>
      </div>
    );
  }

  const selectedSigner = signers.find(
    (s: LabSigner) => s.id === selectedSignerId
  );

  return (
    <div
      className={`rounded-xl p-5 space-y-4 ${
        needsAttention
          ? 'border-2 border-cyan/50 bg-cyan/5'
          : 'border border-gray-800 bg-gray-900'
      }`}
    >
      <h3 className="text-sm font-semibold text-white">
        {t('review.reviewer_panel_title')}
      </h3>

      {/* Signer dropdown */}
      <div>
        <label className="mb-1 block text-xs text-gray-400">
          {t('review.select_signer')}
        </label>
        <select
          value={selectedSignerId}
          onChange={(e) => setSelectedSignerId(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
        >
          <option value="">{t('review.select_signer_placeholder')}</option>
          {signers.map((signer: LabSigner) => (
            <option key={signer.id} value={signer.id}>
              {signer.name} — {signer.title}
              {signer.registrationNumber
                ? ` (${signer.registrationNumber})`
                : ''}
            </option>
          ))}
        </select>
        {selectedSigner && (
          <p className="mt-1 text-xs text-gray-500">
            {selectedSigner.specialty}
            {selectedSigner.university ? ` · ${selectedSigner.university}` : ''}
          </p>
        )}
      </div>

      {/* Analyst dropdown */}
      {analysts && analysts.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">
            {t('review.select_analyst')}
          </label>
          <select
            value={selectedAnalystId}
            onChange={(e) => setSelectedAnalystId(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
          >
            <option value="">{t('review.select_analyst_placeholder')}</option>
            {analysts.map((analyst: LabSigner) => (
              <option key={analyst.id} value={analyst.id}>
                {analyst.name} — {analyst.title}
                {analyst.registrationNumber
                  ? ` (${analyst.registrationNumber})`
                  : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Review notes */}
      <div>
        <label className="mb-1 block text-xs text-gray-400">
          {t('review.review_notes_label')}
        </label>
        <textarea
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          placeholder={t('review.review_notes_placeholder')}
          rows={2}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan focus:outline-none"
        />
      </div>
    </div>
  );
}

function CorrectionBanner({ notes }: { notes: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3">
      <p className="text-sm font-semibold text-yellow-300">
        {t('review.correction_banner')}
      </p>
      <p className="mt-1 text-xs text-yellow-400">
        {t('review.correction_banner_notes')}
      </p>
      <p className="mt-1 text-sm text-yellow-200 whitespace-pre-wrap">
        {notes}
      </p>
    </div>
  );
}

function ReleaseHistorySection({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['release-history', orderId],
    queryFn: () => labApi.release.getHistory(orderId),
    staleTime: 30_000,
  });

  if (!data || data.releases.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-3 text-sm font-semibold text-white">
        {t('review.release_history')}
      </h3>
      <div className="space-y-3">
        {data.releases.map((release) => (
          <div
            key={release.id}
            className="flex items-center justify-between border-b border-gray-800/40 pb-2 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-200">
                {t('review.release_sequence', {
                  seq: release.releaseSequence,
                })}
              </span>
              <StatusBadge status={release.releaseType} size="sm" />
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{release.signerName}</p>
              <p className="text-xs text-gray-500">
                {new Date(release.releasedAt).toLocaleString()}
              </p>
              {release.orderingVetName && (
                <p className="text-xs text-gray-600">
                  {t('workspace.requesting_vet')}: {release.orderingVetName}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Aggregate status */}
      <div className="mt-3 flex items-center gap-2 border-t border-gray-800 pt-2">
        <StatusBadge status={data.aggregateReportStatus} size="sm" />
      </div>
    </div>
  );
}

function AmendmentPanel({
  orderId,
  reportTestId,
  testName,
  onDone,
}: {
  orderId: string;
  reportTestId: string;
  testName: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [amendmentId, setAmendmentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [analytes, setAnalytes] = useState<
    Array<{
      id: string;
      name: string;
      sectionName: string | null;
      isHeader: boolean;
      valueType: string;
      numericValue: number | null;
      textValue: string | null;
      booleanValue: boolean | null;
      selectValue: string | null;
      unit: string | null;
      flag: string | null;
    }>
  >([]);

  const handleInitiate = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const result = await labApi.amendment.initiate(orderId, {
        reportTestId,
        reason,
      });
      setAmendmentId(result.amendmentId);
      setStatus(result.status);
      setAnalytes(result.analytes);
      toast.success(t('review.amendment_initiated'));
    } catch (e) {
      toast.error(`${t('review.amendment_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!amendmentId) return;
    setBusy(true);
    try {
      const result = await labApi.amendment.submitForReview(
        orderId,
        amendmentId
      );
      setStatus(result.status);
      toast.success(t('review.amendment_submitted'));
    } catch (e) {
      toast.error(`${t('review.amendment_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!amendmentId) return;
    // For MVP, use the first available reviewer signer
    setBusy(true);
    try {
      const signers = await labApi.review.getReviewerSigners();
      if (!signers.length) {
        toast.error(t('review.no_reviewer_signers'));
        return;
      }
      await labApi.amendment.approve(orderId, amendmentId, {
        signerId: signers[0].id,
      });
      toast.success(t('review.amendment_approved'));
      onDone();
    } catch (e) {
      toast.error(`${t('review.amendment_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!amendmentId) return;
    setBusy(true);
    try {
      await labApi.amendment.cancel(orderId, amendmentId);
      toast.success(t('review.amendment_cancelled'));
      setAmendmentId(null);
      setStatus(null);
      setAnalytes([]);
      setReason('');
    } catch (e) {
      toast.error(`${t('review.amendment_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <div className="mt-3 rounded-lg border border-blue-800/40 bg-blue-900/10 p-4 space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-28" />
      </div>
    );
  }

  // State: not started — show reason input + initiate button
  if (!amendmentId) {
    return (
      <div className="mt-3 rounded-lg border border-blue-800/40 bg-blue-900/10 p-4 space-y-3">
        <p className="text-sm font-medium text-blue-300">
          {t('review.amend_btn')} — {testName}
        </p>
        <div>
          <label className="mb-1 block text-xs text-gray-400">
            {t('review.amend_reason_label')}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('review.amend_reason_placeholder')}
            rows={2}
            className="w-full rounded-lg border border-blue-800/50 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleInitiate}
            disabled={!reason.trim()}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('review.amend_initiate')}
          </button>
        </div>
      </div>
    );
  }

  // State: initiated (DRAFT) — show analytes read-only, submit/cancel
  if (status === 'DRAFT') {
    return (
      <div className="mt-3 rounded-lg border border-blue-800/40 bg-blue-900/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-blue-300">
            {t('review.amend_btn')} — {testName}
          </p>
          <StatusBadge status="DRAFT" size="sm" />
        </div>

        {/* Read-only analyte values */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
          {analytes
            .filter((a) => !a.isHeader)
            .map((a) => {
              const displayVal =
                a.numericValue !== null
                  ? String(a.numericValue)
                  : a.textValue ??
                    a.selectValue ??
                    a.booleanValue?.toString() ??
                    '—';
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between border-b border-gray-800/40 py-1.5 last:border-0"
                >
                  <span className="text-sm text-gray-300">{a.name}</span>
                  <span className="text-sm text-gray-200">
                    {displayVal}
                    {a.unit && (
                      <span className="ml-1 text-xs text-gray-500">
                        {a.unit}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSubmitForReview}
            className="rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('review.amend_submit_for_review')}
          </button>
          <button
            onClick={handleCancel}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            {t('review.amend_cancel')}
          </button>
        </div>
      </div>
    );
  }

  // State: IN_REVIEW — waiting, or approve if admin
  if (status === 'IN_REVIEW') {
    return (
      <div className="mt-3 rounded-lg border border-indigo-800/40 bg-indigo-900/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-indigo-300">
            {t('review.amend_btn')} — {testName}
          </p>
          <StatusBadge status="IN_REVIEW" size="sm" />
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              {t('review.amend_approve')}
            </button>
            <button
              onClick={handleCancel}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {t('review.amend_cancel')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // State: APPROVED or CANCELLED — done
  return null;
}

export function ReviewReleasePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [amendingTestId, setAmendingTestId] = useState<string | null>(null);

  const [selectedSignerId, setSelectedSignerId] = useState('');
  const [selectedAnalystId, setSelectedAnalystId] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [showCorrections, setShowCorrections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlightReviewer, setHighlightReviewer] = useState(false);
  const reviewerRef = useRef<HTMLDivElement>(null);

  const { data: order, isLoading: loading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => labApi.orders.getById(orderId!) as Promise<LabOrderDetail>,
    enabled: !!orderId,
  });

  const { data: reviewerSigners } = useQuery({
    queryKey: ['reviewer-signers-check'],
    queryFn: () => labApi.review.getReviewerSigners(),
  });
  const hasReviewers = (reviewerSigners?.length ?? 0) > 0;

  // Single batch query for all result sessions — no per-test fetches
  const resultTestIds =
    order?.orderedTests
      .filter((ot: { status: string }) =>
        ['RESULTS_ENTERED', 'IN_REVIEW', 'COMPLETED'].includes(ot.status)
      )
      .map((ot: { id: string }) => ot.id) ?? [];

  const { data: batchSessions } = useQuery({
    queryKey: ['batch-result-sessions', orderId, resultTestIds.join(',')],
    queryFn: () => labApi.resultEntry.batchGetSessions(resultTestIds),
    enabled: resultTestIds.length > 0,
    staleTime: 30_000,
  });

  const sessionByTestId = new Map<string, ResultSession>();
  if (batchSessions) {
    for (const s of batchSessions) {
      if (s?.test?.id) sessionByTestId.set(s.test.id, s as ResultSession);
    }
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    queryClient.removeQueries({ queryKey: ['worklist'] });
    queryClient.removeQueries({ queryKey: ['worklist-counts'] });
    queryClient.invalidateQueries({ queryKey: ['worklist-ready-count'] });
    queryClient.invalidateQueries({ queryKey: ['release-history', orderId] });
    queryClient.invalidateQueries({
      queryKey: ['batch-result-sessions', orderId],
    });
    setSelectedTestIds([]);
    setAmendingTestId(null);
    setSelectedSignerId('');
    setSelectedAnalystId('');
    setReviewNotes('');
    setCorrectionNotes('');
    setShowCorrections(false);
  };

  const handleSubmitForReview = async (testIds?: string[]) => {
    if (!orderId) return;
    setSubmitting(true);
    try {
      await labApi.review.submitForReview(orderId, testIds);
      toast.success(t('review.submit_for_review_success'));
      invalidate();
      setHighlightReviewer(true);
      setTimeout(() => {
        reviewerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 300);
      setTimeout(() => setHighlightReviewer(false), 3000);
    } catch (e) {
      toast.error(
        `${t('review.submit_for_review_error')} ${(e as Error).message}`
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inReviewTests =
    order?.orderedTests.filter((ot) => ot.status === 'IN_REVIEW') ?? [];

  const isPartial = selectedTestIds.length < inReviewTests.length;

  const handleApprove = async () => {
    if (!selectedSignerId || selectedTestIds.length === 0 || !orderId) return;

    const confirmed = await confirm({
      title: t('review.approve_confirm_title'),
      message: isPartial
        ? t('review.approve_confirm_partial', {
            count: selectedTestIds.length,
          })
        : t('review.approve_confirm_final'),
      confirmLabel: t('review.approve_btn'),
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await labApi.review.approveAndRelease(orderId, {
        signerId: selectedSignerId,
        analystId: selectedAnalystId || undefined,
        testIds: selectedTestIds,
        reviewNotes: reviewNotes || undefined,
      });
      toast.success(t('review.approve_success'));
      invalidate();
      navigate('/orders');
    } catch (e) {
      toast.error(`${t('review.approve_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCorrections = async () => {
    if (!correctionNotes.trim() || !orderId) {
      toast.error(t('review.corrections_notes_required'));
      return;
    }
    setBusy(true);
    try {
      await labApi.review.requestCorrections(orderId, correctionNotes);
      toast.success(t('review.corrections_success'));
      invalidate();
    } catch (e) {
      toast.error(`${t('review.corrections_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleTestSelection = (testId: string) => {
    setSelectedTestIds((prev) =>
      prev.includes(testId)
        ? prev.filter((id) => id !== testId)
        : [...prev, testId]
    );
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

  const report = order.resultReport;
  const reportStatus = report?.status;
  const isDraft = reportStatus === 'DRAFT';

  const completedTests = order.orderedTests.filter(
    (ot) => ot.status === 'COMPLETED'
  );
  const enteredTests = order.orderedTests.filter(
    (ot) => ot.status === 'RESULTS_ENTERED'
  );
  const draftOrPendingTests = order.orderedTests.filter(
    (ot) =>
      !['RESULTS_ENTERED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED'].includes(
        ot.status
      )
  );

  const testsWithResults = order.orderedTests.filter((ot) =>
    ['RESULTS_ENTERED', 'IN_REVIEW', 'COMPLETED'].includes(ot.status)
  );

  const allInReviewSelected =
    inReviewTests.length > 0 &&
    inReviewTests.every((ot) => selectedTestIds.includes(ot.id));

  const toggleSelectAll = () => {
    if (allInReviewSelected) {
      setSelectedTestIds([]);
    } else {
      setSelectedTestIds(inReviewTests.map((ot) => ot.id));
    }
  };

  const hasSelectableTests = inReviewTests.length > 0;
  const hasCompletedTests = completedTests.length > 0;
  const hasAnyResults = testsWithResults.length > 0;

  const isFullyReleased =
    hasCompletedTests &&
    !hasSelectableTests &&
    enteredTests.length === 0 &&
    draftOrPendingTests.length === 0;

  const showActionButtons = hasSelectableTests && isAdmin;

  return (
    <div className="p-6 max-w-3xl">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 bg-gray-950 px-6 pt-4 pb-3 border-b border-gray-800">
        <div className="mb-2">
          <Link
            to={`/orders/${order.id}`}
            className="text-sm text-gray-400 hover:text-white"
          >
            {t('review.back')}
          </Link>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">
              {t('review.title', { patient: order.case.patientName })}
            </h1>
            {isFullyReleased && (
              <span className="shrink-0 rounded-full bg-green-900/30 px-3 py-1 text-sm font-medium text-green-400">
                {t('review.already_released')}
              </span>
            )}
            {hasSelectableTests && !isAdmin && (
              <span className="shrink-0 rounded-full bg-blue-900/30 px-3 py-1 text-sm font-medium text-blue-400">
                {t('review.in_review_status')}
              </span>
            )}
          </div>

          {showActionButtons && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowCorrections(!showCorrections)}
                className="rounded-lg border border-yellow-700 px-4 py-2 text-sm font-medium text-yellow-300 hover:bg-yellow-900/30 transition"
              >
                {t('review.corrections_btn')}
              </button>
              <button
                onClick={handleApprove}
                disabled={
                  busy || !selectedSignerId || selectedTestIds.length === 0
                }
                className="rounded-lg bg-purple px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 transition"
              >
                {busy ? t('common.saving') : t('review.approve_btn')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Corrections panel (below header) */}
      {showCorrections && showActionButtons && (
        <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/10 p-4 space-y-3">
          <label className="block text-xs text-yellow-400">
            {t('review.corrections_notes_label')}
          </label>
          <textarea
            value={correctionNotes}
            onChange={(e) => setCorrectionNotes(e.target.value)}
            placeholder={t('review.corrections_notes_placeholder')}
            rows={3}
            className="w-full rounded-lg border border-yellow-800/50 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-yellow-600 focus:outline-none"
          />
          <button
            onClick={handleCorrections}
            disabled={busy || !correctionNotes.trim()}
            className="rounded-lg bg-yellow-700 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('review.corrections_btn')}
          </button>
        </div>
      )}

      {/* Ordering vet */}
      {order.orderingVetName && (
        <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3">
          <p className="text-xs text-gray-400">
            {t('workspace.requesting_vet')}:{' '}
            <span className="font-medium text-white">
              {order.orderingVetName}
            </span>
            {order.orderingVetLicenseNumber && (
              <span className="ml-1 text-gray-500">
                · {t('workspace.vet_license')} {order.orderingVetLicenseNumber}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Released: approver info */}
      {isFullyReleased && report?.approvedByName && report.reviewedAt && (
        <div className="mb-4 rounded-lg border border-green-800/40 bg-green-900/10 px-4 py-3">
          <p className="text-xs text-green-400">
            {t('review.approver_info', {
              name: report.approvedByName,
            })}
            {' · '}
            {new Date(report.reviewedAt).toLocaleString()}
          </p>
          {report.reviewNotes && (
            <p className="mt-1 text-sm text-gray-300">{report.reviewNotes}</p>
          )}
        </div>
      )}

      {/* Submitted timestamp for IN_REVIEW */}
      {hasSelectableTests && report?.submittedForReviewAt && (
        <div className="mb-4 rounded-lg border border-blue-800/40 bg-blue-900/10 px-4 py-3">
          <p className="text-xs text-blue-400">
            {t('review.submitted_at')}
            {' · '}
            {new Date(report.submittedForReviewAt).toLocaleString()}
          </p>
        </div>
      )}

      {/* Correction banner */}
      {isDraft && report?.correctionNotes && (
        <CorrectionBanner notes={report.correctionNotes} />
      )}

      {/* Reviewer controls (admin + IN_REVIEW) */}
      {showActionButtons && (
        <div
          ref={reviewerRef}
          className={`mb-4 rounded-xl transition-all duration-500 ${
            highlightReviewer
              ? 'ring-2 ring-cyan shadow-[0_0_15px_rgba(6,214,160,0.3)]'
              : ''
          }`}
        >
          <ReviewerPanel
            selectedSignerId={selectedSignerId}
            setSelectedSignerId={setSelectedSignerId}
            selectedAnalystId={selectedAnalystId}
            setSelectedAnalystId={setSelectedAnalystId}
            reviewNotes={reviewNotes}
            setReviewNotes={setReviewNotes}
            needsAttention={!selectedSignerId}
          />
        </div>
      )}

      {/* Pending/in-progress tests warning */}
      {draftOrPendingTests.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3">
          <p className="text-sm text-yellow-300">
            {t('review.pending_warning')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draftOrPendingTests.map((test) => (
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

      {/* Select all / deselect all for IN_REVIEW tests */}
      {showActionButtons && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-gray-400">
            {t('review.selected_count', { count: selectedTestIds.length })}
          </p>
          <button
            onClick={toggleSelectAll}
            className="text-xs text-cyan hover:underline"
          >
            {allInReviewSelected
              ? t('review.deselect_all')
              : t('review.select_all')}
          </button>
        </div>
      )}

      {/* Test results */}
      {hasAnyResults ? (
        testsWithResults.map((test) => {
          const isTestInReview = test.status === 'IN_REVIEW';
          const isTestCompleted = test.status === 'COMPLETED';
          const isSelected = selectedTestIds.includes(test.id);
          const readOnly = isTestInReview || isTestCompleted;

          return (
            <div key={test.id}>
              {/* Checkbox / status row */}
              <div className="mb-1 flex items-center gap-2">
                {isTestInReview && isAdmin ? (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTestSelection(test.id)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan accent-cyan"
                    />
                    <span className="text-xs text-gray-400">
                      {test.catalogItemName}
                    </span>
                  </label>
                ) : (
                  <div className="flex items-center gap-2">
                    <StatusBadge status={test.status} size="sm" />
                    <span className="text-xs text-gray-400">
                      {test.catalogItemName}
                    </span>
                  </div>
                )}
              </div>

              <TestResultSection
                orderId={order.id}
                testId={test.id}
                session={sessionByTestId.get(test.id)}
                readOnly={readOnly}
              />

              {/* Amend button for COMPLETED tests */}
              {isTestCompleted && (
                <div className="mb-4">
                  {amendingTestId === test.id ? (
                    <AmendmentPanel
                      orderId={order.id}
                      reportTestId={test.id}
                      testName={test.catalogItemName}
                      onDone={invalidate}
                    />
                  ) : (
                    <button
                      onClick={() => setAmendingTestId(test.id)}
                      className="rounded-lg border border-blue-800/50 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-900/20"
                    >
                      {t('review.amend_btn')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-8 text-center text-sm text-gray-500">
          {t('review.no_report')}
        </div>
      )}

      {/* Submit for review button (for RESULTS_ENTERED tests) */}
      {enteredTests.length > 0 && (
        <div className="mt-6">
          {!hasReviewers && (
            <p className="mb-2 text-sm text-yellow-400">
              {t('review.no_reviewer_warning')}
            </p>
          )}
          {submitting ? (
            <Skeleton className="h-10 w-48 rounded-lg" />
          ) : (
            <button
              onClick={() => handleSubmitForReview()}
              disabled={!hasReviewers}
              className="rounded-lg bg-purple px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('review.submit_for_review_btn')}
            </button>
          )}
        </div>
      )}

      {/* Release history */}
      <ReleaseHistorySection orderId={order.id} />
    </div>
  );
}
