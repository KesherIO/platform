import { useState } from 'react';
import { Skeleton } from '../../shared/components/Skeleton';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { useToast } from '../../shared/components/ToastProvider';
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

function TestResultSection({
  orderId,
  testId,
  readOnly,
}: {
  orderId: string;
  testId: string;
  readOnly: boolean;
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
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [selectedSignerId, setSelectedSignerId] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [showCorrections, setShowCorrections] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: signers, isLoading: loadingSigners } = useQuery({
    queryKey: ['reviewer-signers'],
    queryFn: () => labApi.review.getReviewerSigners(),
    staleTime: 0,
  });

  const handleApprove = async () => {
    if (!selectedSignerId) return;
    setBusy(true);
    try {
      await labApi.review.approveAndRelease(
        orderId,
        selectedSignerId,
        reviewNotes || undefined
      );
      toast.success(t('review.approve_success'));
      onDone();
    } catch (e) {
      toast.error(`${t('review.approve_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setShowConfirm(false);
    }
  };

  const handleCorrections = async () => {
    if (!correctionNotes.trim()) {
      toast.error(t('review.corrections_notes_required'));
      return;
    }
    setBusy(true);
    try {
      await labApi.review.requestCorrections(orderId, correctionNotes);
      toast.success(t('review.corrections_success'));
      onDone();
    } catch (e) {
      toast.error(`${t('review.corrections_error')} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (loadingSigners) {
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
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
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
            {selectedSigner.university
              ? ` · ${selectedSigner.university}`
              : ''}
          </p>
        )}
      </div>

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

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!selectedSignerId || busy}
          className="rounded-lg bg-purple px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('review.approve_btn')}
        </button>
        <button
          onClick={() => setShowCorrections(!showCorrections)}
          disabled={busy}
          className="rounded-lg border border-yellow-700 px-4 py-2.5 text-sm font-medium text-yellow-300 hover:bg-yellow-900/30 disabled:opacity-50"
        >
          {t('review.corrections_btn')}
        </button>
      </div>

      {/* Corrections section */}
      {showCorrections && (
        <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/10 p-4 space-y-3">
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
            {busy ? '...' : t('review.corrections_btn')}
          </button>
        </div>
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="rounded-lg border border-purple/40 bg-purple/10 p-4 space-y-3">
          <p className="text-sm font-medium text-white">
            {t('review.approve_confirm_title')}
          </p>
          <p className="text-xs text-gray-400">
            {t('review.approve_confirm')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              disabled={busy}
              className="rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? '...' : t('common.confirm')}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
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

export function ReviewReleasePage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const { data: order, isLoading: loading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => labApi.orders.getById(orderId!) as Promise<LabOrderDetail>,
    enabled: !!orderId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    queryClient.invalidateQueries({ queryKey: ['worklist-ready-count'] });
    order?.orderedTests.forEach((test) => {
      queryClient.invalidateQueries({
        queryKey: ['result-session', test.id],
      });
    });
  };

  const handleSubmitForReview = async () => {
    if (!orderId) return;
    setSubmitting(true);
    try {
      await labApi.review.submitForReview(orderId);
      toast.success(t('review.submit_for_review_success'));
      invalidate();
    } catch (e) {
      toast.error(
        `${t('review.submit_for_review_error')} ${(e as Error).message}`
      );
    } finally {
      setSubmitting(false);
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

  const report = order.resultReport;
  const reportStatus = report?.status;
  const isReleased = reportStatus === 'RELEASED';
  const isInReview = reportStatus === 'IN_REVIEW';
  const isDraft = reportStatus === 'DRAFT';

  const enteredTests = order.orderedTests.filter((t) =>
    ['RESULTS_ENTERED', 'IN_REVIEW', 'COMPLETED'].includes(t.status)
  );
  const pendingTests = order.orderedTests.filter(
    (t) =>
      !['RESULTS_ENTERED', 'IN_REVIEW', 'COMPLETED', 'CANCELLED'].includes(
        t.status
      )
  );

  const readOnly = isReleased || isInReview;

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

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">
          {t('review.title', { patient: order.case.patientName })}
        </h1>

        {isReleased && (
          <span className="rounded-full bg-green-900/30 px-3 py-1 text-sm font-medium text-green-400">
            {t('review.already_released')}
          </span>
        )}
        {isInReview && !isAdmin && (
          <span className="rounded-full bg-blue-900/30 px-3 py-1 text-sm font-medium text-blue-400">
            {t('review.in_review_status')}
          </span>
        )}
      </div>

      {/* Released: approver info */}
      {isReleased && report?.approvedByName && report.reviewedAt && (
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
      {isInReview && report?.submittedForReviewAt && (
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

      {/* Pending tests warning */}
      {pendingTests.length > 0 && !isReleased && (
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

      {/* Test results */}
      {enteredTests.length > 0 ? (
        enteredTests.map((test) => (
          <TestResultSection
            key={test.id}
            orderId={order.id}
            testId={test.id}
            readOnly={readOnly}
          />
        ))
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-8 text-center text-sm text-gray-500">
          {t('review.no_report')}
        </div>
      )}

      {/* DRAFT: Submit for review button */}
      {isDraft && enteredTests.length > 0 && (
        <div className="mt-6">
          <button
            onClick={handleSubmitForReview}
            disabled={submitting}
            className="rounded-lg bg-purple px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '...' : t('review.submit_for_review_btn')}
          </button>
        </div>
      )}

      {/* IN_REVIEW + admin: Reviewer panel */}
      {isInReview && isAdmin && (
        <div className="mt-6">
          <ReviewerPanel orderId={order.id} onDone={invalidate} />
        </div>
      )}
    </div>
  );
}
