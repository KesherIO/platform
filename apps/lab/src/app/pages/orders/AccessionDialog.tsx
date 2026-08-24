import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import type {
  AccessionSpecimenInput,
  ExpectedSpecimensResponse,
  ExpectedSpecimenGroup,
} from '../../types/lab.types';

interface SpecimenFormState extends AccessionSpecimenInput {
  _key: string;
}

function buildInitialForms(
  data: ExpectedSpecimensResponse,
  requisitionNumber: string
): SpecimenFormState[] {
  if (data.existingSpecimens.length > 0) {
    return data.existingSpecimens.map((sp) => ({
      _key: sp.id,
      specimenType: sp.specimenType,
      containerType: sp.containerType,
      tubeIndex: sp.tubeIndex,
      accessionNumber: sp.accessionNumber,
      accepted: sp.status === 'ACCEPTED',
      rejectionReason: sp.rejectionReason ?? undefined,
      notes: sp.notes ?? undefined,
      isHemolyzed: sp.isHemolyzed,
      isLipemic: sp.isLipemic,
      isIcteric: sp.isIcteric,
      isInsufficient: sp.isInsufficient,
      isContaminated: sp.isContaminated,
      isWrongContainer: sp.isWrongContainer,
      isLeaking: sp.isLeaking,
    }));
  }

  return data.expectedSpecimenGroups.map((g, idx) => ({
    _key: `${g.specimenType}::${g.containerType}::1`,
    specimenType: g.specimenType,
    containerType: g.containerType,
    tubeIndex: 1,
    accessionNumber:
      idx === 0 ? requisitionNumber : `${requisitionNumber}-${idx + 1}`,
    accepted: true,
    isHemolyzed: false,
    isLipemic: false,
    isIcteric: false,
    isInsufficient: false,
    isContaminated: false,
    isWrongContainer: false,
    isLeaking: false,
  }));
}

const CONDITION_FLAGS: (keyof AccessionSpecimenInput)[] = [
  'isHemolyzed',
  'isLipemic',
  'isIcteric',
  'isInsufficient',
  'isContaminated',
  'isWrongContainer',
  'isLeaking',
];

interface Props {
  orderId: string;
  requisitionNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AccessionDialog({
  orderId,
  requisitionNumber,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedData, setExpectedData] =
    useState<ExpectedSpecimensResponse | null>(null);
  const [forms, setForms] = useState<SpecimenFormState[]>([]);

  useEffect(() => {
    labApi.specimens
      .getExpected(orderId)
      .then((data) => {
        setExpectedData(data);
        setForms(buildInitialForms(data, requisitionNumber));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  const updateForm = (key: string, patch: Partial<SpecimenFormState>) => {
    setForms((prev) =>
      prev.map((f) => (f._key === key ? { ...f, ...patch } : f))
    );
  };

  const addTube = (group: ExpectedSpecimenGroup) => {
    const existing = forms.filter(
      (f) =>
        f.specimenType === group.specimenType &&
        f.containerType === group.containerType
    );
    const nextIdx = existing.length + 1;
    const key = `${group.specimenType}::${group.containerType}::${nextIdx}`;
    setForms((prev) => [
      ...prev,
      {
        _key: key,
        specimenType: group.specimenType,
        containerType: group.containerType,
        tubeIndex: nextIdx,
        accessionNumber: '',
        accepted: true,
        isHemolyzed: false,
        isLipemic: false,
        isIcteric: false,
        isInsufficient: false,
        isContaminated: false,
        isWrongContainer: false,
        isLeaking: false,
      },
    ]);
  };

  const quickAcceptAll = () => {
    setForms((prev) =>
      prev.map((f) => ({
        ...f,
        accepted: true,
        rejectionReason: undefined,
        isHemolyzed: false,
        isLipemic: false,
        isIcteric: false,
        isInsufficient: false,
        isContaminated: false,
        isWrongContainer: false,
        isLeaking: false,
      }))
    );
  };

  const handleSubmit = async () => {
    const hasConditionFlag = (f: SpecimenFormState) =>
      f.isHemolyzed ||
      f.isLipemic ||
      f.isIcteric ||
      f.isInsufficient ||
      f.isContaminated ||
      f.isWrongContainer ||
      f.isLeaking;

    for (const f of forms) {
      if (!f.accepted && !f.rejectionReason && !hasConditionFlag(f)) {
        setError(t('accession.rejection_reason_required'));
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await labApi.specimens.accessionOrder(
        orderId,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        forms.map(({ _key, ...rest }) => rest)
      );
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const groupLabel = (f: SpecimenFormState) =>
    `${f.specimenType.replace(/_/g, ' ')} · ${f.containerType.replace(
      /_/g,
      ' '
    )}${f.tubeIndex && f.tubeIndex > 1 ? ` #${f.tubeIndex}` : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {t('accession.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
            </div>
          )}

          {!loading && (
            <>
              {!expectedData && !error && (
                <p className="py-8 text-center text-sm text-gray-500">
                  {t('common.loading')}
                </p>
              )}

              {expectedData?.unconfiguredTests &&
                expectedData.unconfiguredTests.length > 0 && (
                  <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-950/40 px-4 py-3 text-sm text-yellow-300">
                    {t('accession.unconfigured_tests', {
                      count: expectedData.unconfiguredTests.length,
                    })}
                    :{' '}
                    {expectedData.unconfiguredTests
                      .map((t) => t.name)
                      .join(', ')}
                  </div>
                )}

              <div className="mb-4 flex justify-end">
                <button
                  onClick={quickAcceptAll}
                  className="rounded-lg border border-cyan/40 px-3 py-1.5 text-xs text-cyan hover:bg-cyan/10"
                >
                  {t('accession.quick_accept_all')}
                </button>
              </div>

              <div className="space-y-4">
                {forms.map((f) => (
                  <div
                    key={f._key}
                    className="rounded-xl border border-gray-800 bg-gray-900 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">
                        {groupLabel(f)}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            updateForm(f._key, {
                              accepted: true,
                              rejectionReason: undefined,
                            })
                          }
                          className={`rounded-lg px-3 py-1 text-xs font-medium ${
                            f.accepted
                              ? 'bg-emerald-600 text-white'
                              : 'border border-gray-700 text-gray-400 hover:border-emerald-600 hover:text-emerald-400'
                          }`}
                        >
                          {t('accession.accept')}
                        </button>
                        <button
                          onClick={() =>
                            updateForm(f._key, { accepted: false })
                          }
                          className={`rounded-lg px-3 py-1 text-xs font-medium ${
                            !f.accepted
                              ? 'bg-red-700 text-white'
                              : 'border border-gray-700 text-gray-400 hover:border-red-600 hover:text-red-400'
                          }`}
                        >
                          {t('accession.reject')}
                        </button>
                      </div>
                    </div>

                    {/* Accession number */}
                    <div className="mb-3">
                      <label className="mb-1 block text-xs text-gray-400">
                        {t('accession.accession_number')}
                      </label>
                      <input
                        type="text"
                        placeholder={t(
                          'accession.accession_number_placeholder'
                        )}
                        value={f.accessionNumber ?? ''}
                        onChange={(e) =>
                          updateForm(f._key, {
                            accessionNumber: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                      />
                    </div>

                    {/* Condition flags */}
                    <div className="mb-3">
                      <p className="mb-1.5 text-xs text-gray-400">
                        {t('accession.conditions')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {CONDITION_FLAGS.map((flag) => (
                          <button
                            key={flag}
                            onClick={() => {
                              const turningOn = !f[flag];
                              updateForm(f._key, {
                                [flag]: turningOn,
                                ...(turningOn ? { accepted: false } : {}),
                              } as Partial<SpecimenFormState>);
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-xs ${
                              f[flag]
                                ? 'border-yellow-600 bg-yellow-900/40 text-yellow-300'
                                : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'
                            }`}
                          >
                            {t(`accession.flag.${flag}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Rejection reason */}
                    {!f.accepted && (
                      <div className="mb-3">
                        <label className="mb-1 block text-xs text-gray-400">
                          {t('accession.rejection_reason')}
                          {!(
                            f.isHemolyzed ||
                            f.isLipemic ||
                            f.isIcteric ||
                            f.isInsufficient ||
                            f.isContaminated ||
                            f.isWrongContainer ||
                            f.isLeaking
                          ) && <span className="ml-1 text-red-400">*</span>}
                        </label>
                        <input
                          type="text"
                          value={f.rejectionReason ?? ''}
                          onChange={(e) =>
                            updateForm(f._key, {
                              rejectionReason: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    )}

                    {/* Notes */}
                    <div>
                      <label className="mb-1 block text-xs text-gray-400">
                        {t('accession.notes')}
                      </label>
                      <input
                        type="text"
                        value={f.notes ?? ''}
                        onChange={(e) =>
                          updateForm(f._key, { notes: e.target.value })
                        }
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Add tube buttons for each group */}
              {expectedData?.expectedSpecimenGroups.map((g) => (
                <div
                  key={`${g.specimenType}::${g.containerType}`}
                  className="mt-2"
                >
                  <button
                    onClick={() => addTube(g)}
                    className="text-xs text-cyan hover:underline"
                  >
                    +{' '}
                    {t('accession.add_tube', {
                      type: g.specimenType.replace(/_/g, ' '),
                    })}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="border-t border-gray-800 px-6 py-4">
          {error && (
            <p className="mb-3 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={
                submitting ||
                loading ||
                (forms.length === 0 &&
                  (expectedData?.unconfiguredTests.length ?? 0) === 0)
              }
              className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? '...' : t('accession.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
