import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import {
  DRY_RUN_CHUNK_SIZE,
  buildPreviewRows,
  buildRetryCsv,
  checkKey,
  chunk,
  guessMapping,
  inFileDuplicates,
  loadSavedMapping,
  mappingProblems,
  rowBucket,
  runImportGroups,
  saveMapping,
  toRequestRow,
} from '../../shared/clientImport';
import { ImportUploadStep } from './ImportUploadStep';
import { ImportMappingStep } from './ImportMappingStep';
import { ImportPreviewStep } from './ImportPreviewStep';
import { ImportResultStep } from './ImportResultStep';
import { downloadCsv, rowReason } from './importLabels';
import type { TemplateHeaders } from '../../shared/clientImport';
import type {
  ClientType,
  ColumnMapping,
  ImportPreviewRow,
  ImportRowResult,
  LabContactInfo,
  ParsedSheet,
} from '../../types/lab.types';

type Step = 'upload' | 'mapping' | 'preview' | 'result';
const STEPS: Step[] = ['upload', 'mapping', 'preview', 'result'];
const TEMPLATE_LANGUAGES = ['en', 'es'];

interface Props {
  onClose: () => void;
  /** Called on close when at least one client was created */
  onImported: () => void;
}

/**
 * Client bulk import wizard (docs/CLIENT_BULK_IMPORT_PLAN.md B3): upload →
 * column mapping → preview with dry-run checks → import in groups.
 * One importBatchId per wizard, reused for every retry and resume (A2/A5).
 */
export function ImportClientsModal({ onClose, onImported }: Props) {
  const { t, i18n } = useTranslation();
  const { tenantId } = useAuth();
  const [importBatchId] = useState(() => crypto.randomUUID());

  const [step, setStep] = useState<Step>('upload');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [suggested, setSuggested] = useState<ColumnMapping[]>([]);
  const [defaults, setDefaults] = useState<{
    clientType: ClientType;
    country: string;
  }>({ clientType: 'VETERINARY_CLINIC', country: '' });
  const defaultsTouched = useRef(false);

  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [checkError, setCheckError] = useState(false);
  const [checkRetry, setCheckRetry] = useState(0);
  const checkInFlight = useRef(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runError, setRunError] = useState<string | null>(null);

  // The lab's own country preselects the default (Settings → Laboratory).
  const { data: contact } = useQuery({
    queryKey: ['lab-contact'],
    queryFn: () => labApi.settings.getContactInfo() as Promise<LabContactInfo>,
  });
  useEffect(() => {
    if (contact?.country && !defaultsTouched.current) {
      setDefaults((d) => ({ ...d, country: contact.country ?? '' }));
    }
  }, [contact?.country]);

  const templates = useMemo(
    () =>
      TEMPLATE_LANGUAGES.map(
        (lng) =>
          i18n.getFixedT(lng)('clients.import.template', {
            returnObjects: true,
          }) as TemplateHeaders
      ),
    [i18n]
  );
  const currentTemplate = t('clients.import.template', {
    returnObjects: true,
  }) as TemplateHeaders & { status: string; reason: string };

  const duplicates = useMemo(() => inFileDuplicates(rows), [rows]);
  const buckets = useMemo(
    () => new Map(rows.map((r) => [r.rowNumber, rowBucket(r, duplicates)])),
    [rows, duplicates]
  );
  const countBucket = (bucket: string) =>
    [...buckets.values()].filter((b) => b === bucket).length;

  // --- Upload → mapping ----------------------------------------------------

  const handleFileParsed = (parsed: ParsedSheet, name: string) => {
    const guess = guessMapping(parsed.headers, templates);
    setSheet(parsed);
    setFileName(name);
    setSuggested(guess);
    setMapping(
      (tenantId && loadSavedMapping(tenantId, parsed.headers)) || guess
    );
  };

  const goToPreview = () => {
    if (!sheet) return;
    if (tenantId) saveMapping(tenantId, sheet.headers, mapping);
    const labels = TEMPLATE_LANGUAGES.map(
      (lng) =>
        i18n.getFixedT(lng)('clients.type', { returnObjects: true }) as Record<
          ClientType,
          string
        >
    );
    setRows(
      buildPreviewRows(sheet, mapping, {
        defaults,
        clientTypeLabels: labels,
        templateNotesHeaders: templates.map((tpl) => tpl.notes),
      })
    );
    setCheckError(false);
    setStep('preview');
  };

  // --- Dry-run checks (A4) -------------------------------------------------
  // Rows that need a check are sent in groups, ~500 ms after the last edit.
  // A result is kept with the values it was checked with, so a row edited
  // while its check was in flight is checked again.

  useEffect(() => {
    if (step !== 'preview' || running || checkError) return;
    const pending = rows.filter((r) => buckets.get(r.rowNumber) === 'checking');
    if (pending.length === 0) return;

    const timer = setTimeout(async () => {
      if (checkInFlight.current) return;
      checkInFlight.current = true;
      try {
        for (const group of chunk(pending, DRY_RUN_CHUNK_SIZE)) {
          const keys = new Map(
            group.map((r) => [r.rowNumber, checkKey(r.values)])
          );
          const response = await labApi.clients.import({
            importBatchId,
            dryRun: true,
            rows: group.map(toRequestRow),
          });
          const byRow = new Map(response.results.map((r) => [r.rowNumber, r]));
          setRows((all) =>
            all.map((r) => {
              const result = byRow.get(r.rowNumber);
              const key = keys.get(r.rowNumber);
              return result && key ? { ...r, check: { key, result } } : r;
            })
          );
        }
      } catch {
        setCheckError(true);
      } finally {
        checkInFlight.current = false;
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [rows, buckets, step, running, checkError, checkRetry, importBatchId]);

  // --- Import (A5) ---------------------------------------------------------

  const applyResults = useCallback((results: ImportRowResult[]) => {
    const byRow = new Map(results.map((r) => [r.rowNumber, r]));
    setRows((all) =>
      all.map((r) => {
        const imported = byRow.get(r.rowNumber);
        return imported ? { ...r, imported } : r;
      })
    );
  }, []);

  const runImport = async (toSend: ImportPreviewRow[]) => {
    setStep('result');
    setRunning(true);
    setRunError(null);
    setProgress({ done: 0, total: toSend.length });

    const outcome = await runImportGroups({
      rows: toSend.map(toRequestRow),
      send: (group) => labApi.clients.import({ importBatchId, rows: group }),
      onGroup: (results) => {
        applyResults(results);
        setProgress((p) => ({ ...p, done: p.done + results.length }));
      },
    });

    if (outcome.notConfirmed.length > 0) {
      const unconfirmed = new Set(outcome.notConfirmed.map((r) => r.rowNumber));
      setRows((all) =>
        all.map((r) =>
          unconfirmed.has(r.rowNumber) ? { ...r, imported: 'not_confirmed' } : r
        )
      );
      setRunError((outcome.error as Error | undefined)?.message ?? null);
    }
    setRunning(false);
  };

  // Rows the server should decide on. "Already in your lab" rows are sent
  // too: the final summary comes only from the import response.
  const importable = rows.filter((r) => {
    const b = buckets.get(r.rowNumber);
    return b === 'will_create' || b === 'already_in_lab';
  });
  const willCreate = countBucket('will_create');
  const checking = countBucket('checking');
  const needsReview = countBucket('needs_review');
  const canImport =
    willCreate > 0 && checking === 0 && needsReview === 0 && !checkError;

  const resumable = rows.filter(
    (r) =>
      r.imported === 'not_confirmed' ||
      (r.imported !== null && r.imported.status === 'failed')
  );

  // Leaving the page mid-import asks first; closing the modal is disabled.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const handleClose = () => {
    if (running) return;
    if (
      rows.some(
        (r) =>
          r.imported !== null &&
          r.imported !== 'not_confirmed' &&
          r.imported.status === 'created'
      )
    ) {
      onImported();
    }
    onClose();
  };

  const downloadRetryFile = () =>
    downloadCsv(
      buildRetryCsv(rows, {
        headers: currentTemplate,
        clientTypeLabel: (code) =>
          t(`clients.type.${code}`, { defaultValue: code }),
        statusLabel: (row) =>
          t(`clients.import.buckets.${buckets.get(row.rowNumber) ?? 'failed'}`),
        reasonLabel: (row) =>
          rowReason(t, row, buckets.get(row.rowNumber) ?? 'failed'),
      }),
      t('clients.import.result.retry_filename')
    );

  // --- Render --------------------------------------------------------------

  const footerButton =
    'rounded-lg px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {t('clients.import.title')}
          </h2>
          <ol className="flex gap-3 text-xs">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={
                  s === step ? 'font-semibold text-cyan' : 'text-gray-500'
                }
              >
                {i + 1}. {t(`clients.import.steps.${s}`)}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'upload' && (
            <ImportUploadStep
              defaults={defaults}
              onDefaultsChange={(d) => {
                defaultsTouched.current = true;
                setDefaults(d);
              }}
              labHasCountry={!!contact?.country}
              templateHeaders={currentTemplate}
              sheet={sheet}
              fileName={fileName}
              onFileParsed={handleFileParsed}
            />
          )}
          {step === 'mapping' && sheet && (
            <ImportMappingStep
              sheet={sheet}
              mapping={mapping}
              suggested={suggested}
              onChange={setMapping}
            />
          )}
          {step === 'preview' && (
            <ImportPreviewStep
              rows={rows}
              duplicates={duplicates}
              onRowsChange={setRows}
              checkError={checkError}
              onRetryCheck={() => {
                setCheckError(false);
                setCheckRetry((n) => n + 1);
              }}
            />
          )}
          {step === 'result' && (
            <ImportResultStep
              rows={rows}
              buckets={buckets}
              running={running}
              progress={progress}
              runError={runError}
              canResume={!running && resumable.length > 0}
              onResume={() => runImport(resumable)}
              onDownloadRetry={downloadRetryFile}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-800 px-6 py-4">
          <div className="text-xs text-gray-500">
            {step === 'preview' &&
              (checking > 0
                ? t('clients.import.preview.waiting_checks', {
                    count: checking,
                  })
                : needsReview > 0
                ? t('clients.import.preview.waiting_review', {
                    count: needsReview,
                  })
                : willCreate === 0
                ? t('clients.import.preview.nothing_to_import')
                : null)}
          </div>
          <div className="flex gap-3">
            {step !== 'result' && (
              <button
                onClick={handleClose}
                className={`${footerButton} border border-gray-700 text-gray-300 hover:bg-gray-800`}
              >
                {t('clients.import.cancel')}
              </button>
            )}
            {(step === 'mapping' || step === 'preview') && (
              <button
                onClick={() =>
                  setStep(step === 'mapping' ? 'upload' : 'mapping')
                }
                className={`${footerButton} border border-gray-700 text-gray-300 hover:bg-gray-800`}
              >
                {t('clients.import.back')}
              </button>
            )}
            {step === 'upload' && (
              <button
                onClick={() => setStep('mapping')}
                disabled={!sheet}
                className={`${footerButton} bg-cyan font-semibold text-gray-950 hover:opacity-90`}
              >
                {t('clients.import.next')}
              </button>
            )}
            {step === 'mapping' && (
              <button
                onClick={goToPreview}
                disabled={mappingProblems(mapping).length > 0}
                className={`${footerButton} bg-cyan font-semibold text-gray-950 hover:opacity-90`}
              >
                {t('clients.import.next')}
              </button>
            )}
            {step === 'preview' && (
              <button
                onClick={() => runImport(importable)}
                disabled={!canImport}
                className={`${footerButton} bg-cyan font-semibold text-gray-950 hover:opacity-90`}
              >
                {t('clients.import.preview.import_button', {
                  count: willCreate,
                })}
              </button>
            )}
            {step === 'result' && (
              <button
                onClick={handleClose}
                disabled={running}
                className={`${footerButton} border border-gray-700 text-gray-300 hover:bg-gray-800`}
              >
                {t('clients.import.close')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
