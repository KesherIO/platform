import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { labApi } from '../api/labApi';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from './ToastProvider';
import type { ReleaseInfo } from '../../types/lab.types';

interface ReleasePdfMenuProps {
  orderId: string;
  requisitionNumber: string;
  releases: ReleaseInfo[];
}

const BUTTON_CLASS =
  'rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50';

const DOWNLOAD_BUTTON_CLASS =
  'rounded-lg border border-cyan/40 bg-cyan/10 px-4 py-2 text-sm font-medium text-cyan hover:bg-cyan/20 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * "Download PDF" action for an order's releases. With a single release the
 * button acts directly on that release's PDF; with several it opens a
 * dropdown listing every release (type, date, tests) so the user picks
 * which PDF to download — each release PDF only covers its own tests.
 */
export function ReleasePdfMenu({
  orderId,
  requisitionNumber,
  releases,
}: ReleasePdfMenuProps) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleDownload = async (release: ReleaseInfo) => {
    setBusyId(release.id);
    try {
      await labApi.release.downloadPdf(
        release.id,
        `${requisitionNumber}-release-${release.releaseSequence}.pdf`
      );
      setOpen(false);
    } catch {
      toast.error(t('review.pdf_download_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = async (release: ReleaseInfo) => {
    setBusyId(release.id);
    try {
      await labApi.release.retryPdf(release.id);
      // Invalidate so the query sees PENDING and restarts polling
      await queryClient.invalidateQueries({
        queryKey: ['release-history', orderId],
      });
    } catch {
      toast.error(t('review.pdf_failed'));
    } finally {
      setBusyId(null);
    }
  };

  if (releases.length === 0) return null;

  // ── Single release: the button is the action ──
  if (releases.length === 1) {
    const release = releases[0];
    const busy = busyId === release.id;

    if (release.pdfStatus === 'COMPLETED') {
      return (
        <button
          onClick={() => void handleDownload(release)}
          disabled={busy}
          className={DOWNLOAD_BUTTON_CLASS}
        >
          {busy ? '...' : t('review.pdf_download')}
        </button>
      );
    }
    if (release.pdfStatus === 'FAILED') {
      return isAdmin ? (
        <button
          onClick={() => void handleRetry(release)}
          disabled={busy}
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
        >
          {busy ? '...' : t('review.pdf_retry')}
        </button>
      ) : (
        <button disabled className={BUTTON_CLASS}>
          {t('review.pdf_failed')}
        </button>
      );
    }
    return (
      <button disabled className={`${BUTTON_CLASS} italic`}>
        {t('review.pdf_generating')}
      </button>
    );
  }

  // ── Several releases: dropdown, one row per release ──
  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`${DOWNLOAD_BUTTON_CLASS} flex items-center gap-1.5`}
      >
        {t('review.pdf_download')}
        <ChevronDown size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-gray-700 bg-gray-900 p-1.5 shadow-2xl"
        >
          {[...releases]
            .sort((a, b) => b.releaseSequence - a.releaseSequence)
            .map((release) => {
              const busy = busyId === release.id;
              return (
                <div
                  key={release.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-800/60"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200">
                      {t('review.release_sequence', {
                        seq: release.releaseSequence,
                      })}{' '}
                      · {t(`status.${release.releaseType}`)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(release.releasedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {t('review.release_test_count', {
                        count: release.tests.length,
                      })}
                    </p>
                    <p
                      className="truncate text-xs text-gray-600"
                      title={release.tests
                        .map((test) => test.catalogItemName)
                        .join(', ')}
                    >
                      {release.tests
                        .map((test) => test.catalogItemName)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {release.pdfStatus === 'COMPLETED' ? (
                      <button
                        role="menuitem"
                        onClick={() => void handleDownload(release)}
                        disabled={busy}
                        className="text-xs font-medium text-cyan hover:text-cyan/80 disabled:opacity-50"
                      >
                        {busy ? '...' : t('review.pdf_download_short')}
                      </button>
                    ) : release.pdfStatus === 'FAILED' ? (
                      isAdmin ? (
                        <button
                          role="menuitem"
                          onClick={() => void handleRetry(release)}
                          disabled={busy}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          {busy ? '...' : t('review.pdf_retry')}
                        </button>
                      ) : (
                        <span className="text-xs text-red-400">
                          {t('review.pdf_failed')}
                        </span>
                      )
                    ) : (
                      <span className="text-xs italic text-gray-500">
                        {t('review.pdf_generating')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
