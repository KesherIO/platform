import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { useToast } from '../../shared/components/ToastProvider';
import { Skeleton } from '../../shared/components/Skeleton';
import { ObservationPhrasesPicker } from '../../shared/components/ObservationPhrasesPicker';
import { AnalyteInput } from '../../shared/components/AnalyteInput';
import type { AnalyteValue } from '../../shared/components/AnalyteInput';
import { evaluateAllFormulas } from '../../shared/formula';
import type { LabOrderDetail, OrderedTest } from '../../types/lab.types';
import { ChevronDown, ChevronRight, CheckCircle2, Circle } from 'lucide-react';

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

type Session = {
  test: { id: string; name: string; code: string | null; status: string };
  template: {
    title: string;
    defaultObservations: string | null;
    observationPhrases: Array<{
      code: string;
      label: string;
      text: string;
      sectionCode?: string;
    }> | null;
  };
  report: {
    id: string;
    observations: string | null;
    correctionNotes?: string | null;
  } | null;
  sections: Array<{
    id: string | null;
    name: string | null;
    analytes: Analyte[];
  }>;
};

type TestValues = Record<string, AnalyteValue>;
type AllValues = Record<string, TestValues>;
type AllObservations = Record<string, string>;

export function BatchResultEntryPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const packageOriginId = searchParams.get('packageOriginId');
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<AllValues>({});
  const [observations, setObservations] = useState<AllObservations>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collapsedTests, setCollapsedTests] = useState<Set<string>>(new Set());
  const savedValuesRef = useRef<AllValues>({});
  const savedObservationsRef = useRef<AllObservations>({});
  const initialized = useRef(false);

  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => labApi.orders.getById(orderId ?? ''),
    enabled: !!orderId,
  });

  const packageTests = useMemo<OrderedTest[]>(() => {
    if (!order || !packageOriginId) return [];
    const detail = order as LabOrderDetail;
    return detail.orderedTests.filter((test) =>
      test.sources.some(
        (s) =>
          s.sourceType === 'PACKAGE' &&
          s.originCatalogItemId === packageOriginId
      )
    );
  }, [order, packageOriginId]);

  const packageName = useMemo(() => {
    if (!packageTests.length) return '';
    const source = packageTests[0].sources.find(
      (s) =>
        s.sourceType === 'PACKAGE' && s.originCatalogItemId === packageOriginId
    );
    return source?.originName ?? '';
  }, [packageTests, packageOriginId]);

  const testIds = useMemo(() => packageTests.map((t) => t.id), [packageTests]);

  const sessionQueries = useQuery({
    queryKey: ['batch-result-sessions', testIds],
    queryFn: () =>
      labApi.resultEntry.batchGetSessions(testIds) as Promise<Session[]>,
    enabled: testIds.length > 0,
    staleTime: 30_000,
  });

  const sessions = sessionQueries.data ?? [];

  useEffect(() => {
    if (!sessions.length || initialized.current) return;
    initialized.current = true;

    const initValues: AllValues = {};
    const initObs: AllObservations = {};

    for (const session of sessions) {
      const testVals: TestValues = {};
      for (const section of session.sections) {
        for (const a of section.analytes) {
          if (a.isHeader) continue;
          testVals[a.id] = {
            numericValue: a.numericValue,
            textValue: a.textValue,
            booleanValue: a.booleanValue,
            selectValue: a.selectValue,
          };
        }
      }
      initValues[session.test.id] = testVals;

      const hasSavedValues = session.sections.some((s) =>
        s.analytes.some((a) => a.savedValueId)
      );
      initObs[session.test.id] = hasSavedValues
        ? session.report?.observations ??
          session.template.defaultObservations ??
          ''
        : session.template.defaultObservations ?? '';
    }

    setValues(initValues);
    setObservations(initObs);
    savedValuesRef.current = initValues;
    savedObservationsRef.current = initObs;
  }, [sessions]);

  const formulaResults = useMemo(() => {
    const result: Record<string, Record<string, number | null>> = {};
    for (const session of sessions) {
      const allAnalytes = session.sections.flatMap((s) => s.analytes);
      const testVals = values[session.test.id] ?? {};
      const forEval = allAnalytes
        .filter((a: Analyte) => !a.isHeader)
        .map((a: Analyte) => ({
          code: a.code,
          formula: a.formula,
          numericValue: testVals[a.id]?.numericValue ?? null,
        }));
      const computed = evaluateAllFormulas(forEval);
      const byAnalyteId: Record<string, number | null> = {};
      for (const a of allAnalytes) {
        if (a.formula && !a.isHeader) {
          byAnalyteId[a.id] = computed[a.code] ?? null;
        }
      }
      result[session.test.id] = byAnalyteId;
    }
    return result;
  }, [sessions, values]);

  const formulaCodes = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const session of sessions) {
      result[session.test.id] = new Set(
        session.sections
          .flatMap((s) => s.analytes)
          .filter((a: Analyte) => a.formula && !a.isHeader)
          .map((a: Analyte) => a.id)
      );
    }
    return result;
  }, [sessions]);

  const handleAnalyteChange = useCallback(
    (testId: string, analyteId: string, val: AnalyteValue) => {
      setValues((prev) => ({
        ...prev,
        [testId]: { ...prev[testId], [analyteId]: val },
      }));
    },
    []
  );

  const handleObservationChange = useCallback(
    (testId: string, text: string) => {
      setObservations((prev) => ({ ...prev, [testId]: text }));
    },
    []
  );

  const toggleCollapse = useCallback((testId: string) => {
    setCollapsedTests((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  }, []);

  function buildPayloadForTest(testId: string) {
    const testValues = values[testId] ?? {};
    const testFormulaCodes = formulaCodes[testId] ?? new Set();
    return Object.entries(testValues)
      .filter(([id]) => !testFormulaCodes.has(id))
      .map(([templateAnalyteId, v]) => ({
        templateAnalyteId,
        ...v,
      }));
  }

  const handleSave = useCallback(async () => {
    if (!sessions.length) return;
    setSaving(true);
    try {
      await Promise.all(
        sessions.map((s) =>
          labApi.resultEntry.saveAnalytes(
            s.test.id,
            buildPayloadForTest(s.test.id),
            observations[s.test.id] || null
          )
        )
      );
      savedValuesRef.current = { ...values };
      savedObservationsRef.current = { ...observations };
      for (const s of sessions) {
        queryClient.invalidateQueries({
          queryKey: ['result-session', s.test.id],
        });
      }
      toast.success(t('batch_result_entry.saved'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [sessions, values, observations, t, toast, queryClient]);

  const handleSubmit = async () => {
    if (!orderId || !sessions.length) return;
    setSubmitting(true);
    try {
      for (const s of sessions) {
        await labApi.resultEntry.saveAnalytes(
          s.test.id,
          buildPayloadForTest(s.test.id),
          observations[s.test.id] || null
        );
        const isUpdate = s.test.status === 'RESULTS_ENTERED';
        if (!isUpdate) {
          await labApi.resultEntry.submit(s.test.id);
        }
      }
      for (const s of sessions) {
        queryClient.invalidateQueries({
          queryKey: ['result-session', s.test.id],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['worklist-ready-count'] });
      queryClient.invalidateQueries({ queryKey: ['worklist'] });
      toast.success(t('batch_result_entry.submitted'));
      navigate(`/orders/${orderId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  function getTestCompletionStatus(session: Session) {
    const testVals = values[session.test.id] ?? {};
    const editableAnalytes = session.sections
      .flatMap((s) => s.analytes)
      .filter((a) => !a.isHeader && !a.formula);
    if (editableAnalytes.length === 0) return 'empty';
    const filled = editableAnalytes.filter((a) => {
      const v = testVals[a.id];
      if (!v) return false;
      return (
        (v.numericValue !== null && v.numericValue !== undefined) ||
        (v.textValue !== null && v.textValue !== undefined) ||
        (v.booleanValue !== null && v.booleanValue !== undefined) ||
        (v.selectValue !== null && v.selectValue !== undefined)
      );
    });
    if (filled.length === 0) return 'empty';
    if (filled.length === editableAnalytes.length) return 'complete';
    return 'partial';
  }

  const isLoading = orderLoading || sessionQueries.isLoading;

  if (isLoading || saving || submitting) {
    return (
      <div className="p-6 max-w-3xl">
        <Skeleton className="mb-6 h-4 w-24" />
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="mb-4 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
          >
            <Skeleton className="mb-4 h-5 w-48" />
            {[1, 2, 3].map((j) => (
              <div
                key={j}
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
        ))}
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className="p-6 text-gray-400">
        {t('batch_result_entry.not_found')}
      </div>
    );
  }

  const anyUpdate = sessions.some((s) => s.test.status === 'RESULTS_ENTERED');
  const isDirty =
    JSON.stringify(values) !== JSON.stringify(savedValuesRef.current) ||
    JSON.stringify(observations) !==
      JSON.stringify(savedObservationsRef.current);

  const detail = order as LabOrderDetail;

  return (
    <div className="flex h-full flex-col max-w-3xl">
      <div className="sticky top-0 z-10 bg-gray-950 px-6 pt-6 pb-4 border-b border-gray-800">
        <div className="mb-2">
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-gray-400 hover:text-white"
          >
            {t('batch_result_entry.back')}
          </button>
        </div>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{packageName}</h1>
            <p className="text-sm text-gray-400">
              {detail.requisitionNumber} &middot; {detail.patientName} (
              {detail.patientSpecies})
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {t('batch_result_entry.subtitle', {
                count: sessions.length,
              })}
            </p>
          </div>
          <div className="flex gap-2">
            {!anyUpdate && (
              <button
                onClick={handleSave}
                disabled={saving || submitting}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                {t('batch_result_entry.save_draft')}
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={saving || submitting || (anyUpdate && !isDirty)}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {anyUpdate
                ? t('batch_result_entry.update_all')
                : t('batch_result_entry.submit_all')}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4 space-y-4">
        {sessions.map((session) => {
          const isCollapsed = collapsedTests.has(session.test.id);
          const completion = getTestCompletionStatus(session);
          const testFormulaResults = formulaResults[session.test.id] ?? {};
          const isReadOnly = ![
            'READY',
            'IN_PROGRESS',
            'RESULTS_ENTERED',
          ].includes(session.test.status);

          return (
            <div
              key={session.test.id}
              className="rounded-xl border border-gray-800 bg-gray-900"
            >
              {/* Test section header */}
              <button
                type="button"
                onClick={() => toggleCollapse(session.test.id)}
                className="flex w-full items-center justify-between px-5 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  )}
                  <div>
                    <span className="text-sm font-semibold text-white">
                      {session.test.name}
                    </span>
                    {session.test.code && (
                      <span className="ml-2 font-mono text-xs text-gray-500">
                        {session.test.code}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {completion === 'complete' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : completion === 'partial' ? (
                    <Circle className="h-4 w-4 text-yellow-400" />
                  ) : (
                    <Circle className="h-4 w-4 text-gray-600" />
                  )}
                  <span
                    className={`text-xs ${
                      completion === 'complete'
                        ? 'text-emerald-400'
                        : completion === 'partial'
                        ? 'text-yellow-400'
                        : 'text-gray-600'
                    }`}
                  >
                    {t(`batch_result_entry.section_${completion}`)}
                  </span>
                </div>
              </button>

              {/* Analytes */}
              {!isCollapsed && (
                <div className="border-t border-gray-800 px-5 pb-4">
                  {session.sections.map((section, si) => (
                    <div key={section.id ?? si} className="mt-3">
                      {section.name && (
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {section.name}
                        </h3>
                      )}
                      <div className="divide-y divide-gray-800/40">
                        {section.analytes.map((analyte) => (
                          <AnalyteInput
                            key={analyte.id}
                            analyte={analyte}
                            value={values[session.test.id]?.[analyte.id] ?? {}}
                            formulaResult={testFormulaResults[analyte.id]}
                            isReadOnly={isReadOnly}
                            onChange={(analyteId, val) =>
                              handleAnalyteChange(
                                session.test.id,
                                analyteId,
                                val
                              )
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Per-test observations */}
                  <div className="mt-4">
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
                              const current = prev[session.test.id] ?? '';
                              if (!current.trim())
                                return { ...prev, [session.test.id]: text };
                              return {
                                ...prev,
                                [session.test.id]:
                                  current.trimEnd() + '\n' + text,
                              };
                            });
                          }}
                        />
                      )}
                    <textarea
                      readOnly={isReadOnly}
                      rows={2}
                      value={observations[session.test.id] ?? ''}
                      onChange={(e) =>
                        handleObservationChange(session.test.id, e.target.value)
                      }
                      className={`w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan focus:outline-none resize-none ${
                        isReadOnly ? 'opacity-60' : ''
                      }`}
                      placeholder={t('result_entry.observations_placeholder')}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
