import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labApi, apiErrorMessage } from '../../shared/api/labApi';
import type { ReceiveSpecimenInput, Specimen } from '../../types/lab.types';

const CONDITION_FLAGS = [
  'isHemolyzed',
  'isLipemic',
  'isIcteric',
  'isInsufficient',
  'isContaminated',
  'isWrongContainer',
  'isLeaking',
] as const;

/**
 * Receives one awaited (or missing) tube — e.g. the new sample for tests
 * added after the first one arrived. Only the tests waiting for this tube
 * move; the rest of the order is untouched.
 */
export function ReceiveSpecimenDialog({
  specimen,
  onClose,
  onSuccess,
}: {
  specimen: Specimen;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ReceiveSpecimenInput>({
    accepted: true,
    accessionNumber: specimen.accessionNumber,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCondition = CONDITION_FLAGS.some((flag) => form[flag]);
  const update = (patch: Partial<ReceiveSpecimenInput>) =>
    setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.accepted && !form.rejectionReason?.trim() && !hasCondition) {
      setError(t('accession.rejection_reason_required'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await labApi.specimens.receive(specimen.id, {
        ...form,
        accessionNumber: form.accessionNumber?.trim() || undefined,
        rejectionReason: form.accepted
          ? undefined
          : form.rejectionReason?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
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
              {t('specimens.receive_title')}
            </h2>
            <p className="text-xs text-gray-400">
              {specimen.specimenType.replace(/_/g, ' ')} ·{' '}
              {specimen.containerType.replace(/_/g, ' ')}
            </p>
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
          <div className="flex gap-2">
            <button
              onClick={() =>
                update({ accepted: true, rejectionReason: undefined })
              }
              className={`rounded-lg px-3 py-1 text-xs font-medium ${
                form.accepted
                  ? 'bg-emerald-600 text-white'
                  : 'border border-gray-700 text-gray-400 hover:border-emerald-600 hover:text-emerald-400'
              }`}
            >
              {t('accession.accept')}
            </button>
            <button
              onClick={() => update({ accepted: false })}
              className={`rounded-lg px-3 py-1 text-xs font-medium ${
                !form.accepted
                  ? 'bg-red-700 text-white'
                  : 'border border-gray-700 text-gray-400 hover:border-red-600 hover:text-red-400'
              }`}
            >
              {t('accession.reject')}
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t('accession.accession_number')}
            </label>
            <input
              type="text"
              value={form.accessionNumber ?? ''}
              onChange={(e) => update({ accessionNumber: e.target.value })}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs text-gray-400">
              {t('accession.conditions')}
            </p>
            <div className="flex flex-wrap gap-2">
              {CONDITION_FLAGS.map((flag) => (
                <button
                  key={flag}
                  onClick={() => {
                    const turningOn = !form[flag];
                    update({
                      [flag]: turningOn,
                      ...(turningOn ? { accepted: false } : {}),
                    });
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${
                    form[flag]
                      ? 'border-yellow-600 bg-yellow-900/40 text-yellow-300'
                      : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                  }`}
                >
                  {t(`accession.flag.${flag}`)}
                </button>
              ))}
            </div>
          </div>

          {!form.accepted && (
            <div>
              <label className="mb-1 block text-xs text-gray-400">
                {t('accession.rejection_reason')}
                {!hasCondition && <span className="ml-1 text-red-400">*</span>}
              </label>
              <input
                type="text"
                value={form.rejectionReason ?? ''}
                onChange={(e) => update({ rejectionReason: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-gray-400">
              {t('accession.notes')}
            </label>
            <input
              type="text"
              value={form.notes ?? ''}
              onChange={(e) => update({ notes: e.target.value })}
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
            disabled={submitting}
            className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
          >
            {submitting
              ? t('accession.confirming')
              : t('specimens.receive_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
