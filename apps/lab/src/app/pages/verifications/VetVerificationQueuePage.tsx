import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  XCircle,
  ShieldOff,
  ExternalLink,
  AlertTriangle,
  X,
} from 'lucide-react';
import { labApi } from '../../shared/api/labApi';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import { useAuth } from '../../auth/AuthContext';
import type {
  VetVerificationSummary,
  VetVerificationDetail,
  VetVerificationEventType,
} from '../../types/lab.types';

const TOOLBAR_TAB =
  'flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950';
const TOOLBAR_TAB_ACTIVE = 'border-cyan/30 bg-cyan/10 text-cyan';
const TOOLBAR_TAB_INACTIVE =
  'border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white';

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface DetailPanelProps {
  id: string;
  onClose: () => void;
  onActionComplete: () => void;
}

function DetailPanel({ id, onClose, onActionComplete }: DetailPanelProps) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['verification', id],
    queryFn: () => labApi.verifications.getById(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['verifications'] });
    queryClient.invalidateQueries({ queryKey: ['verification', id] });
    queryClient.invalidateQueries({
      queryKey: ['pending-verifications-count'],
    });
    onActionComplete();
  };

  const handleApprove = async () => {
    const confirmed = await confirm({
      title: t('verifications.approve_title'),
      message: t('verifications.approve_message'),
      confirmLabel: t('verifications.approve_btn'),
      variant: 'default',
      icon: CheckCircle,
    });
    if (!confirmed) return;

    setActionLoading(true);
    try {
      await labApi.verifications.approve(id);
      toast.success(t('verifications.approved_success'));
      invalidate();
    } catch (err) {
      toast.error(
        `${t('verifications.error_approve')} ${(err as Error).message}`
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectReason.trim()) return;

    setActionLoading(true);
    try {
      await labApi.verifications.reject(id, rejectReason.trim());
      toast.success(t('verifications.rejected_success'));
      setRejectOpen(false);
      setRejectReason('');
      invalidate();
    } catch (err) {
      toast.error(
        `${t('verifications.error_reject')} ${(err as Error).message}`
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeSubmit = async () => {
    if (!revokeReason.trim()) return;

    setActionLoading(true);
    try {
      await labApi.verifications.revoke(id, revokeReason.trim());
      toast.success(t('verifications.revoked_success'));
      setRevokeOpen(false);
      setRevokeReason('');
      invalidate();
    } catch (err) {
      toast.error(
        `${t('verifications.error_revoke')} ${(err as Error).message}`
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewDocument = async () => {
    setLoadingDoc(true);
    try {
      const { signedUrl } = await labApi.verifications.getDocument(id);
      setDocumentUrl(signedUrl);
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(
        `${t('verifications.error_document')} ${(err as Error).message}`
      );
    } finally {
      setLoadingDoc(false);
    }
  };

  const eventLabel = (type: VetVerificationEventType): string => {
    return t(`verifications.event.${type}`, { defaultValue: type });
  };

  if (isLoading || !detail) {
    return (
      <div className="flex h-full flex-col border-l border-gray-800 bg-gray-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-32 animate-pulse rounded bg-gray-700" />
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  const d = detail as VetVerificationDetail;
  const isPending = d.status === 'PENDING';
  const isApproved = d.status === 'APPROVED';

  return (
    <div className="flex h-full flex-col border-l border-gray-800 bg-gray-900">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-800 p-4">
        <div>
          <p className="text-sm font-semibold text-white">{d.vetLegalName}</p>
          <StatusBadge status={d.status} size="sm" />
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Duplicate license warning */}
        {d.duplicateLicenseDetected && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-amber-400"
            />
            <p className="text-xs text-amber-300">
              {t('verifications.duplicate_license_warning')}
            </p>
          </div>
        )}

        {/* Profile changed after approval warning */}
        {d.profileChangedAfterApproval && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-yellow-400"
            />
            <p className="text-xs text-yellow-300">
              {t('verifications.profile_changed_warning')}
            </p>
          </div>
        )}

        {/* Vet info */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t('verifications.section_vet')}
          </h3>
          <div className="space-y-2 text-sm">
            <Row label={t('verifications.field_name')} value={d.vetLegalName} />
            {d.vetEmail && (
              <Row label={t('verifications.field_email')} value={d.vetEmail} />
            )}
            <Row
              label={t('verifications.field_clinic')}
              value={d.initiatingClinicName}
            />
            <Row
              label={t('verifications.field_submitted')}
              value={formatDateTime(d.submittedAt)}
            />
          </div>
        </section>

        {/* Credential info */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t('verifications.section_credential')}
          </h3>
          <div className="space-y-2 text-sm">
            <Row
              label={t('verifications.field_license')}
              value={d.licenseNumber}
            />
            <Row
              label={t('verifications.field_country')}
              value={d.issuingCountry}
            />
            {d.issuingAuthority && (
              <Row
                label={t('verifications.field_authority')}
                value={d.issuingAuthority}
              />
            )}
            {d.licenseExpiresAt && (
              <Row
                label={t('verifications.field_expires')}
                value={formatDate(d.licenseExpiresAt)}
              />
            )}
          </div>
        </section>

        {/* Document viewer */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t('verifications.section_document')}
          </h3>
          <button
            type="button"
            onClick={handleViewDocument}
            disabled={loadingDoc}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition disabled:opacity-50"
          >
            <ExternalLink size={14} />
            {loadingDoc
              ? t('verifications.doc_loading')
              : t('verifications.doc_open')}
          </button>
          {documentUrl && (
            <p className="mt-1 text-xs text-gray-500">
              {t('verifications.doc_opened_hint')}
            </p>
          )}
        </section>

        {/* Rejection / revocation info */}
        {d.status === 'REJECTED' && d.rejectionReason && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('verifications.section_rejection')}
            </h3>
            <p className="text-sm text-red-300">{d.rejectionReason}</p>
            {d.reviewedByName && (
              <p className="mt-1 text-xs text-gray-500">
                {t('verifications.reviewed_by', { name: d.reviewedByName })}
              </p>
            )}
          </section>
        )}

        {d.status === 'REVOKED' && d.revokedReason && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('verifications.section_revocation')}
            </h3>
            <p className="text-sm text-gray-300">{d.revokedReason}</p>
            {d.revokedAt && (
              <p className="mt-1 text-xs text-gray-500">
                {formatDateTime(d.revokedAt)}
              </p>
            )}
          </section>
        )}

        {/* Audit events */}
        {d.events.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t('verifications.section_history')}
            </h3>
            <div className="space-y-2">
              {d.events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-800/50 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-300">
                      {eventLabel(ev.eventType)}
                    </p>
                    {ev.reason && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {ev.reason}
                      </p>
                    )}
                    {ev.actorName && (
                      <p className="mt-0.5 text-xs text-gray-600">
                        {ev.actorName}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-xs text-gray-600">
                    {formatDateTime(ev.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Actions */}
      {isAdmin && (isPending || isApproved) && (
        <div className="shrink-0 border-t border-gray-800 p-4 space-y-3">
          {isPending && (
            <>
              <button
                type="button"
                onClick={handleApprove}
                disabled={actionLoading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan px-4 py-2.5 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                <CheckCircle size={15} />
                {t('verifications.approve_btn')}
              </button>

              {rejectOpen ? (
                <div className="space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={t('verifications.reject_reason_placeholder')}
                    rows={3}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-400 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRejectOpen(false);
                        setRejectReason('');
                      }}
                      disabled={actionLoading}
                      className="flex-1 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition disabled:opacity-50"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleRejectSubmit}
                      disabled={!rejectReason.trim() || actionLoading}
                      className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition"
                    >
                      {actionLoading
                        ? t('verifications.rejecting')
                        : t('verifications.reject_confirm_btn')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRejectOpen(true)}
                  disabled={actionLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 px-4 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition"
                >
                  <XCircle size={15} />
                  {t('verifications.reject_btn')}
                </button>
              )}
            </>
          )}

          {isApproved && (
            <>
              {revokeOpen ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400">
                    {t('verifications.revoke_reason_label')}
                  </p>
                  <textarea
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder={t('verifications.revoke_reason_placeholder')}
                    rows={3}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRevokeOpen(false);
                        setRevokeReason('');
                      }}
                      disabled={actionLoading}
                      className="flex-1 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 transition disabled:opacity-50"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleRevokeSubmit}
                      disabled={!revokeReason.trim() || actionLoading}
                      className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700 disabled:opacity-50 transition"
                    >
                      {actionLoading
                        ? t('verifications.revoking')
                        : t('verifications.revoke_confirm_btn')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevokeOpen(true)}
                  disabled={actionLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition"
                >
                  <ShieldOff size={15} />
                  {t('verifications.revoke_btn')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="text-right text-gray-200">{value}</span>
    </div>
  );
}

export function VetVerificationQueuePage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    'PENDING'
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['verifications', { status: statusFilter, search, page }],
    queryFn: () =>
      labApi.verifications.list({
        status: statusFilter,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    staleTime: 0,
  });

  const items = (data?.data ?? []) as VetVerificationSummary[];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const FILTER_TABS = [
    { label: t('verifications.filter.all'), value: undefined },
    { label: t('verifications.filter.pending'), value: 'PENDING' },
    { label: t('verifications.filter.approved'), value: 'APPROVED' },
    { label: t('verifications.filter.rejected'), value: 'REJECTED' },
    { label: t('verifications.filter.revoked'), value: 'REVOKED' },
  ];

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleFilterChange = (value: string | undefined) => {
    setStatusFilter(value);
    setPage(1);
  };

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div
        className={`flex flex-1 flex-col overflow-hidden ${
          selectedId ? 'hidden md:flex' : ''
        }`}
      >
        <div className="flex-1 overflow-y-auto p-6">
          <h1 className="mb-6 text-xl font-bold text-white">
            {t('verifications.title')}
          </h1>

          {/* Filter bar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {FILTER_TABS.map((tab) => (
              <button
                key={String(tab.value)}
                type="button"
                onClick={() => handleFilterChange(tab.value)}
                className={`${TOOLBAR_TAB} ${
                  statusFilter === tab.value
                    ? TOOLBAR_TAB_ACTIVE
                    : TOOLBAR_TAB_INACTIVE
                }`}
              >
                {tab.label}
              </button>
            ))}
            <div className="ml-auto">
              <SearchInput
                value={search}
                onChange={handleSearchChange}
                placeholder={t('verifications.search_placeholder')}
              />
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg bg-gray-800"
                />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">
              {t('verifications.error')} {(error as Error).message}
            </p>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">
              {t('verifications.empty')}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs text-gray-500">
                      <th className="px-4 py-3 font-medium">
                        {t('verifications.col_vet')}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('verifications.col_license')}
                      </th>
                      <th className="hidden px-4 py-3 font-medium md:table-cell">
                        {t('verifications.col_country')}
                      </th>
                      <th className="hidden px-4 py-3 font-medium lg:table-cell">
                        {t('verifications.col_clinic')}
                      </th>
                      <th className="hidden px-4 py-3 font-medium lg:table-cell">
                        {t('verifications.col_submitted')}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('verifications.col_status')}
                      </th>
                      <th className="px-4 py-3 font-medium">
                        {t('verifications.col_actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800 bg-gray-950">
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        className={`transition hover:bg-gray-900 ${
                          selectedId === item.id ? 'bg-gray-900' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-white">
                          {item.vetLegalName}
                        </td>
                        <td className="px-4 py-3 text-gray-300">
                          {item.licenseNumber}
                        </td>
                        <td className="hidden px-4 py-3 text-gray-400 md:table-cell">
                          {item.issuingCountry}
                          {item.issuingAuthority && (
                            <span className="block text-xs text-gray-500">
                              {item.issuingAuthority}
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-gray-400 lg:table-cell">
                          {item.initiatingClinicName}
                        </td>
                        <td className="hidden px-4 py-3 text-gray-400 lg:table-cell">
                          {formatDate(item.submittedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.status} size="sm" />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition"
                          >
                            {t('verifications.review_btn')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div className="w-full shrink-0 overflow-hidden md:w-96">
          <DetailPanel
            id={selectedId}
            onClose={() => setSelectedId(null)}
            onActionComplete={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}
