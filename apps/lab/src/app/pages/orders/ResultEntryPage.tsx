import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { useToast } from '../../shared/components/ToastProvider';
import { Skeleton } from '../../shared/components/Skeleton';
import { ObservationPhrasesPicker } from '../../shared/components/ObservationPhrasesPicker';
import { AnalyteInput } from '../../shared/components/AnalyteInput';
import type { AnalyteValue } from '../../shared/components/AnalyteInput';
import { evaluateAllFormulas } from '../../shared/formula';
import type { LabOrderDetail } from '../../types/lab.types';

type Analyte = {
  id: string;
  code: string;
  name: string;
  technique: string | null;
  valueType: string;
  unit: string | null;
  options: string[];
  referenceRange: { min?: number; max?: number; displayText: string } | null;
  isHeader: boolean;
  formula: string | null;
  sortOrder: number;
  savedValueId: string | null;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
};

type Values = Record<string, AnalyteValue>;

export function ResultEntryPage() {
  const { orderId, testId } = useParams<{ orderId: string; testId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<Values>({});
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const savedValuesRef = useRef<Values>({});
  const savedObservationsRef = useRef<string>('');
  const initialized = useRef(false);

  const {
    data: session,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['result-session', testId],
    queryFn: () => labApi.resultEntry.getSession(testId ?? ''),
    enabled: !!testId,
    staleTime: 30_000,
  });

  const { data: orderContext } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => labApi.orders.getById(orderId!) as Promise<LabOrderDetail>,
    enabled: !!orderId,
    staleTime: 30_000,
  });

  // Initialize local form state once when session first arrives from cache or network
  useEffect(() => {
    if (!session || initialized.current) return;
    initialized.current = true;
    const initial: Values = {};
    for (const section of session.sections) {
      for (const a of section.analytes) {
        if (a.isHeader) continue;
        initial[a.id] = {
          numericValue: a.numericValue,
          textValue: a.textValue,
          booleanValue: a.booleanValue,
          selectValue: a.selectValue,
        };
      }
    }
    const hasSavedValues = session.sections.some((s) =>
      s.analytes.some((a) => a.savedValueId)
    );
    const initialObs = hasSavedValues
      ? session.report?.observations ??
        session.template.defaultObservations ??
        ''
      : session.template.defaultObservations ?? '';
    setValues(initial);
    setObservations(initialObs);
    savedValuesRef.current = initial;
    savedObservationsRef.current = initialObs;
  }, [session]);

  const allAnalytes = useMemo(() => {
    if (!session) return [];
    return session.sections.flatMap((s: { analytes: Analyte[] }) => s.analytes);
  }, [session]);

  const formulaCodes = useMemo(() => {
    return new Set(
      allAnalytes
        .filter((a: Analyte) => a.formula && !a.isHeader)
        .map((a: Analyte) => a.id)
    );
  }, [allAnalytes]);

  const formulaValues = useMemo(() => {
    if (!allAnalytes.length) return {};
    const forEval = allAnalytes
      .filter((a: Analyte) => !a.isHeader)
      .map((a: Analyte) => ({
        code: a.code,
        formula: a.formula,
        numericValue: values[a.id]?.numericValue ?? null,
      }));
    return evaluateAllFormulas(forEval);
  }, [allAnalytes, values]);

  const formulaByAnalyteId = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const a of allAnalytes) {
      if (a.formula && !a.isHeader) {
        map[a.id] = formulaValues[a.code] ?? null;
      }
    }
    return map;
  }, [allAnalytes, formulaValues]);

  const buildAnalytePayload = () =>
    Object.entries(values)
      .filter(([id]) => !formulaCodes.has(id))
      .map(([templateAnalyteId, v]) => ({
        templateAnalyteId,
        ...v,
      }));

  const handleSave = useCallback(async () => {
    if (!testId || !session) return;
    setSaving(true);
    try {
      await labApi.resultEntry.saveAnalytes(
        testId,
        buildAnalytePayload(),
        observations || null
      );
      savedValuesRef.current = values;
      savedObservationsRef.current = observations;
      // Update cache so navigating back still shows fresh values
      queryClient.invalidateQueries({ queryKey: ['result-session', testId] });
      toast.success(t('result_entry.saved'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [testId, session, values, observations, t, toast, queryClient]);

  const handleAnalyteChange = useCallback(
    (analyteId: string, val: AnalyteValue) => {
      setValues((prev) => ({ ...prev, [analyteId]: val }));
    },
    []
  );

  const isUpdate = session?.test.status === 'RESULTS_ENTERED';

  const handleSubmit = async () => {
    if (!testId || !orderId) return;
    setSubmitting(true);
    try {
      await labApi.resultEntry.saveAnalytes(
        testId,
        buildAnalytePayload(),
        observations || null
      );
      if (!isUpdate) {
        await labApi.resultEntry.submit(testId);
      }
      queryClient.invalidateQueries({ queryKey: ['result-session', testId] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['worklist-ready-count'] });
      toast.success(
        isUpdate ? t('result_entry.updated') : t('result_entry.submitted')
      );
      navigate(`/orders/${orderId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || submitting || saving) {
    return (
      <div className="p-6 max-w-3xl">
        <Skeleton className="mb-6 h-4 w-24" />
        <div className="mb-6 flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <Skeleton className="mb-4 h-3 w-24" />
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-gray-800/40 py-3 last:border-0"
            >
              <Skeleton className="h-4 w-40" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <Skeleton className="mb-3 h-3 w-24" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (queryError || !session) {
    return (
      <div className="p-6 text-red-400">
        {queryError
          ? (queryError as Error).message
          : t('result_entry.not_found')}
      </div>
    );
  }

  const isReadOnly = !['READY', 'IN_PROGRESS', 'RESULTS_ENTERED'].includes(
    session.test.status
  );
  const isDirty =
    JSON.stringify(values) !== JSON.stringify(savedValuesRef.current) ||
    observations !== savedObservationsRef.current;

  return (
    <div className="flex h-full flex-col max-w-3xl">
      <div className="sticky top-0 z-10 bg-gray-950 px-6 pt-6 pb-4 border-b border-gray-800">
        <div className="mb-2">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-400 hover:text-white"
          >
            {t('result_entry.back')}
          </button>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">
              {session.test.name}
            </h1>
            {session.test.code && (
              <p className="font-mono text-sm text-gray-400">
                {session.test.code}
              </p>
            )}
            <p className="mt-1 text-sm text-gray-500">
              {session.template.title}
            </p>
            {orderContext?.orderingVetName && (
              <p className="mt-1 text-xs text-gray-500">
                {t('workspace.requesting_vet')}:{' '}
                <span className="text-gray-400">
                  {orderContext.orderingVetName}
                  {orderContext.orderingVetLicenseNumber
                    ? ` · ${orderContext.orderingVetLicenseNumber}`
                    : ''}
                </span>
              </p>
            )}
          </div>
          {!isReadOnly && (
            <div className="flex gap-2">
              {!isUpdate && (
                <button
                  onClick={handleSave}
                  disabled={saving || submitting}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? '...' : t('result_entry.save_draft')}
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={saving || submitting || (isUpdate && !isDirty)}
                className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {submitting
                  ? '...'
                  : isUpdate
                  ? t('result_entry.update')
                  : t('result_entry.submit')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
        {session.report?.correctionNotes && (
          <div className="mb-4 rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3">
            <p className="text-sm font-semibold text-yellow-300">
              {t('review.correction_banner')}
            </p>
            <p className="mt-1 text-xs text-yellow-400">
              {t('review.correction_banner_notes')}
            </p>
            <p className="mt-1 text-sm text-yellow-200 whitespace-pre-wrap">
              {session.report.correctionNotes}
            </p>
          </div>
        )}

        {session.sections.map((section, si) => (
          <div
            key={section.id ?? si}
            className="mb-4 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
          >
            {section.name && (
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {section.name}
              </h2>
            )}
            <div className="divide-y divide-gray-800/40">
              {section.analytes.map((analyte) => (
                <AnalyteInput
                  key={analyte.id}
                  analyte={analyte}
                  value={values[analyte.id] ?? {}}
                  formulaResult={formulaByAnalyteId[analyte.id]}
                  isReadOnly={isReadOnly}
                  onChange={handleAnalyteChange}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            {t('result_entry.observations')}
          </label>
          {session.template.observationPhrases &&
            session.template.observationPhrases.length > 0 && (
              <ObservationPhrasesPicker
                phrases={session.template.observationPhrases}
                disabled={isReadOnly}
                onInsert={(text) => {
                  setObservations((prev) => {
                    if (!prev.trim()) return text;
                    return prev.trimEnd() + '\n' + text;
                  });
                }}
              />
            )}
          <textarea
            readOnly={isReadOnly}
            rows={3}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            className={`w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan focus:outline-none resize-none ${
              isReadOnly ? 'opacity-60' : ''
            }`}
            placeholder={t('result_entry.observations_placeholder')}
          />
        </div>
      </div>
    </div>
  );
}
