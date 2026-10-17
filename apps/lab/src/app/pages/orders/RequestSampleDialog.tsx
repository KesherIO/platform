import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { labApi, apiErrorMessage } from '../../shared/api/labApi';
import type { OrderedTest } from '../../types/lab.types';

/**
 * Asks the clinic for another tube for a test blocked by its sample
 * (rejected, missing, insufficient). The test goes back to waiting, an
 * awaited tube is recorded and the clinic is notified — no pickup is created.
 */
export function RequestSampleDialog({
  orderId,
  test,
  onClose,
  onSuccess,
}: {
  orderId: string;
  test: OrderedTest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [specimenType, setSpecimenType] = useState('');
  const [containerType, setContainerType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tests without a configured requirement: staff say which sample is needed
  const { data: expected, isLoading } = useQuery({
    queryKey: ['expected-specimens', orderId],
    queryFn: () => labApi.specimens.getExpected(orderId),
  });
  const needsSampleKind =
    expected?.unconfiguredTests.some((u) => u.id === test.id) ?? false;

  const submit = async () => {
    if (needsSampleKind && (!specimenType.trim() || !containerType.trim())) {
      setError(t('specimens.request_sample_kind_required'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await labApi.specimens.requestSample(test.id, {
        note: note.trim() || undefined,
        ...(needsSampleKind
          ? {
              specimenType: specimenType
                .trim()
                .toUpperCase()
                .replace(/\s+/g, '_'),
              containerType: containerType
                .trim()
                .toUpperCase()
                .replace(/\s+/g, '_'),
            }
          : {}),
      });
      onSuccess();
    } catch (e) {
      setError(apiErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {t('specimens.request_sample_title')}
            </h2>
            <p className="text-xs text-gray-400">{test.catalogItemName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          <p className="rounded-lg border border-amber-900/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
            {t('specimens.request_sample_explainer')}
          </p>

          {needsSampleKind && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  {t('specimens.specimen_type')}
                  <span className="ml-1 text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={specimenType}
                  onChange={(e) => setSpecimenType(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  {t('specimens.container_type')}
                  <span className="ml-1 text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={containerType}
                  onChange={(e) => setContainerType(e.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t('specimens.request_sample_note')}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-800 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={submitting || isLoading}
            className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '…' : t('specimens.request_sample_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
