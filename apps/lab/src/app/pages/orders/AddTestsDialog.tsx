import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { labApi, apiErrorMessage } from '../../shared/api/labApi';
import type { AddTestsPreview, AddTestsResult } from '../../types/lab.types';

/**
 * Adds tests (or packages) to an open order, only onto samples already
 * accepted at the lab. Choose, preview which tests can be added and on which
 * tubes, confirm each tube has enough usable sample left, then save. Adding
 * never requests a sample or creates a pickup; the clinic is told for
 * information.
 */
export function AddTestsDialog({
  orderId,
  onClose,
  onSuccess,
}: {
  orderId: string;
  onClose: () => void;
  onSuccess: (result: AddTestsResult) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<AddTestsPreview | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: catalog, isLoading } = useQuery({
    queryKey: ['catalog-active'],
    queryFn: () => labApi.catalog.listActive(),
  });

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.data ?? []).filter(
      (i) =>
        i.active &&
        (!q ||
          i.name.toLowerCase().includes(q) ||
          (i.code ?? '').toLowerCase().includes(q))
    );
  }, [catalog, search]);

  const toggle = (id: string) => {
    setPreview(null);
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  };

  const run = async <T,>(fn: () => Promise<T>, then: (r: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      then(await fn());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const showPreview = () =>
    run(
      () => labApi.specimens.previewAddTests(orderId, selected),
      (p) => {
        setConfirmed([]);
        setPreview(p);
      }
    );

  const toggleConfirmed = (id: string) =>
    setConfirmed((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );

  const allConfirmed =
    !!preview && preview.specimens.every((s) => confirmed.includes(s.id));

  const confirm = () =>
    run(
      () =>
        labApi.specimens.addTests(
          orderId,
          selected,
          confirmed,
          note.trim() || undefined
        ),
      onSuccess
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {t('specimens.add_tests_title')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 py-5">
          {!preview ? (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('specimens.add_tests_search')}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
              <ul className="max-h-64 divide-y divide-gray-800 overflow-y-auto rounded-lg border border-gray-800">
                {isLoading && (
                  <li className="px-3 py-2 text-sm text-gray-500">…</li>
                )}
                {!isLoading && items.length === 0 && (
                  <li className="px-3 py-2 text-sm text-gray-500">
                    {t('specimens.add_tests_none')}
                  </li>
                )}
                {items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-900">
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                      <span className="flex-1 text-sm text-white">
                        {item.name}
                        {item.code && (
                          <span className="ml-2 text-xs text-gray-500">
                            {item.code}
                          </span>
                        )}
                      </span>
                      {item.kind === 'PACKAGE' && (
                        <span className="rounded bg-purple/20 px-1.5 py-0.5 text-[10px] text-purple">
                          {item.kind}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {preview.tests.length === 0 ? (
                <p className="text-sm text-amber-300">
                  {t('specimens.add_tests_nothing_new')}
                </p>
              ) : (
                <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
                  {preview.tests.map((test) => (
                    <li
                      key={test.catalogItemId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="text-sm text-white">{test.name}</span>
                      <span
                        className={`text-xs ${
                          test.outcome === 'READY'
                            ? 'text-green-400'
                            : test.outcome === 'NO_TEMPLATE'
                            ? 'text-amber-300'
                            : 'text-red-400'
                        }`}
                      >
                        {t(`specimens.add_tests_outcome.${test.outcome}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {preview.alreadyOnOrder.length > 0 && (
                <p className="text-xs text-gray-400">
                  {t('specimens.add_tests_already', {
                    names: preview.alreadyOnOrder.map((a) => a.name).join(', '),
                  })}
                </p>
              )}

              {preview.tests.length > 0 && !preview.canAdd && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-200"
                >
                  <p>{t('specimens.add_tests_lab_samples_only')}</p>
                  <p className="mt-1">{t('specimens.add_tests_not_addable')}</p>
                </div>
              )}

              {preview.canAdd && preview.specimens.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-xs font-semibold text-gray-300">
                    {t('specimens.add_tests_confirm_title')}
                  </legend>
                  {preview.specimens.map((sp) => (
                    <label
                      key={sp.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-800 px-3 py-2 hover:bg-gray-900"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmed.includes(sp.id)}
                        onChange={() => toggleConfirmed(sp.id)}
                      />
                      <span className="text-xs text-gray-200">
                        {t('specimens.add_tests_confirm_specimen', {
                          accession: sp.accessionNumber,
                          specimen: sp.specimenType,
                          container: sp.containerType,
                          tests: sp.testNames.join(', '),
                        })}
                        {sp.conditions.length > 0 && (
                          <span className="mt-0.5 block text-amber-300">
                            {t('specimens.add_tests_conditions', {
                              conditions: sp.conditions
                                .map((c) => t(`accession.flag.${c}`))
                                .join(', '),
                            })}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  {t('specimens.add_tests_note')}
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-800 px-6 py-4">
          {preview ? (
            <>
              <button
                onClick={() => setPreview(null)}
                disabled={busy}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('specimens.add_tests_back')}
              </button>
              <button
                onClick={confirm}
                disabled={busy || !preview.canAdd || !allConfirmed}
                className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {busy ? '…' : t('specimens.add_tests_confirm')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={showPreview}
                disabled={busy || selected.length === 0}
                className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {busy ? '…' : t('specimens.add_tests_preview')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
