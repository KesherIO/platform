import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { useToast } from '../../shared/components/ToastProvider';
import { Skeleton } from '../../shared/components/Skeleton';

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

type Values = Record<
  string,
  {
    numericValue?: number | null;
    textValue?: string | null;
    booleanValue?: boolean | null;
    selectValue?: string | null;
  }
>;

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
    const initialObs =
      session.report?.observations ??
      session.template.defaultObservations ??
      '';
    setValues(initial);
    setObservations(initialObs);
    savedValuesRef.current = initial;
    savedObservationsRef.current = initialObs;
  }, [session]);

  const buildAnalytePayload = () =>
    Object.entries(values).map(([templateAnalyteId, v]) => ({
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
      // Invalidate both the session cache and the parent order so workspace refreshes
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

  if (loading) {
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
  const isUpdate = session.test.status === 'RESULTS_ENTERED';
  const isDirty =
    JSON.stringify(values) !== JSON.stringify(savedValuesRef.current) ||
    observations !== savedObservationsRef.current;

  const renderAnalyteInput = (analyte: Analyte) => {
    if (analyte.isHeader) {
      return (
        <div className="col-span-2 pt-2 pb-1">
          <p className="text-sm font-semibold text-gray-200">{analyte.name}</p>
          {analyte.technique && (
            <p className="text-xs text-gray-500">{analyte.technique}</p>
          )}
        </div>
      );
    }

    const val = values[analyte.id] ?? {};

    const refRange = analyte.referenceRange;
    const numVal = val.numericValue;
    const isHigh =
      refRange?.max !== undefined &&
      numVal !== null &&
      numVal !== undefined &&
      numVal > refRange.max;
    const isLow =
      refRange?.min !== undefined &&
      numVal !== null &&
      numVal !== undefined &&
      numVal < refRange.min;
    const flagColor = isHigh
      ? 'text-red-400'
      : isLow
      ? 'text-blue-400'
      : 'text-emerald-400';

    return (
      <div
        key={analyte.id}
        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 border-b border-gray-800/60 last:border-0"
      >
        <div>
          <p className="text-sm text-gray-200">{analyte.name}</p>
          {analyte.technique && (
            <p className="text-xs text-gray-500">{analyte.technique}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {analyte.formula ? (
            <input
              type="number"
              readOnly
              placeholder="—"
              value={val.numericValue ?? ''}
              className="w-24 rounded-lg border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-right text-sm text-gray-400 focus:outline-none"
            />
          ) : analyte.valueType === 'NUMERIC' ? (
            <input
              type="number"
              step="any"
              readOnly={isReadOnly}
              value={val.numericValue ?? ''}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [analyte.id]: {
                    ...prev[analyte.id],
                    numericValue:
                      e.target.value === '' ? null : Number(e.target.value),
                  },
                }))
              }
              className={`w-24 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm text-white focus:border-cyan focus:outline-none ${
                isReadOnly ? 'opacity-60' : ''
              } ${isHigh || isLow ? flagColor : ''}`}
            />
          ) : analyte.valueType === 'TEXT' ? (
            <input
              type="text"
              readOnly={isReadOnly}
              value={val.textValue ?? ''}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [analyte.id]: {
                    ...prev[analyte.id],
                    textValue: e.target.value || null,
                  },
                }))
              }
              className={`w-40 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none ${
                isReadOnly ? 'opacity-60' : ''
              }`}
            />
          ) : analyte.valueType === 'SELECT' ? (
            <select
              disabled={isReadOnly}
              value={val.selectValue ?? ''}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [analyte.id]: {
                    ...prev[analyte.id],
                    selectValue: e.target.value || null,
                  },
                }))
              }
              className={`rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none ${
                isReadOnly ? 'opacity-60' : ''
              }`}
            >
              <option value="">—</option>
              {analyte.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : analyte.valueType === 'BOOLEAN' ? (
            <div className="flex gap-1">
              {['Positivo', 'Negativo'].map((opt) => {
                const isPos = opt === 'Positivo';
                const selected = val.booleanValue === isPos;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={isReadOnly}
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        [analyte.id]: {
                          ...prev[analyte.id],
                          booleanValue: selected ? null : isPos,
                        },
                      }))
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium border ${
                      selected
                        ? isPos
                          ? 'border-red-500 bg-red-900/40 text-red-300'
                          : 'border-emerald-500 bg-emerald-900/40 text-emerald-300'
                        : 'border-gray-700 text-gray-500 hover:border-gray-500'
                    } disabled:opacity-60`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : null}

          {analyte.unit && (
            <span className="text-xs text-gray-500 w-12 shrink-0">
              {analyte.unit}
            </span>
          )}
        </div>

        <div className="text-right">
          {refRange && (
            <p
              className={`text-xs ${
                isHigh || isLow ? flagColor : 'text-gray-600'
              }`}
            >
              {isHigh ? '▲ H' : isLow ? '▼ L' : ''} {refRange.displayText}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-4">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-400 hover:text-white"
        >
          {t('result_entry.back')}
        </button>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{session.test.name}</h1>
          {session.test.code && (
            <p className="font-mono text-sm text-gray-400">
              {session.test.code}
            </p>
          )}
          <p className="mt-1 text-sm text-gray-500">{session.template.title}</p>
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
              <div key={analyte.id}>{renderAnalyteInput(analyte)}</div>
            ))}
          </div>
        </div>
      ))}

      <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('result_entry.observations')}
        </label>
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
  );
}
