import { useState, useEffect, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import type {
  CatalogItem,
  CatalogItemKind,
  ResultType,
} from '../../types/lab.types';

const RESULT_TYPES: ResultType[] = ['NUMERIC', 'TEXT', 'POSITIVE_NEGATIVE'];

interface CatalogItemModalProps {
  mode: 'create' | 'edit';
  item?: CatalogItem;
  onClose: () => void;
  onSaved: () => void;
}

export function CatalogItemModal({
  mode,
  item,
  onClose,
  onSaved,
}: CatalogItemModalProps) {
  const { t } = useTranslation();

  const [kind, setKind] = useState<CatalogItemKind>(item?.kind ?? 'TEST');
  const [name, setName] = useState(item?.name ?? '');
  const [code, setCode] = useState(item?.code ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [turnaroundHours, setTurnaroundHours] = useState(
    item?.turnaroundHours != null ? String(item.turnaroundHours) : ''
  );
  const [resultType, setResultType] = useState<ResultType | ''>(
    item?.resultType ?? ''
  );
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [componentIds, setComponentIds] = useState<string[]>(
    item?.components?.map((c) => c.id) ?? []
  );

  const [availableTests, setAvailableTests] = useState<CatalogItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'PACKAGE') return;
    labApi.catalog.listActive().then((res) => {
      setAvailableTests(
        res.data.filter((i) => i.kind === 'TEST' && i.id !== item?.id)
      );
    });
  }, [kind, item?.id]);

  const toggleComponent = (id: string) => {
    setComponentIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const payload: Record<string, unknown> = {
      name,
      code: code || undefined,
      category: kind === 'TEST' ? category || undefined : undefined,
      turnaroundHours:
        kind === 'TEST' && turnaroundHours
          ? Number(turnaroundHours)
          : undefined,
      resultType: kind === 'TEST' ? resultType || undefined : undefined,
      unit: kind === 'TEST' ? unit || undefined : undefined,
      description: kind === 'PACKAGE' ? description || undefined : undefined,
      componentIds: kind === 'PACKAGE' ? componentIds : undefined,
    };
    if (mode === 'create') payload.kind = kind;

    try {
      if (mode === 'create') {
        await labApi.catalog.create(payload);
      } else if (item) {
        await labApi.catalog.update(item.id, payload);
      }
      onSaved();
    } catch (err) {
      setFormError(
        `${t(
          mode === 'create' ? 'catalog.errors.create' : 'catalog.errors.update'
        )} ${(err as Error).message}`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {mode === 'create'
              ? t('catalog.form.create_title')
              : t('catalog.form.edit_title')}
          </h2>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('catalog.form.kind')} *
            </label>
            <select
              required
              disabled={mode === 'edit'}
              value={kind}
              onChange={(e) => setKind(e.target.value as CatalogItemKind)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none disabled:opacity-60"
            >
              <option value="TEST">{t('catalog.kind.TEST')}</option>
              <option value="PACKAGE">{t('catalog.kind.PACKAGE')}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('catalog.form.name')} *
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('catalog.form.code')}
            </label>
            <input
              value={code}
              disabled={mode === 'edit'}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-gray-500">
              {mode === 'edit'
                ? t('catalog.form.code_hint_locked')
                : t('catalog.form.code_hint')}
            </p>
          </div>

          {kind === 'TEST' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-400">
                    {t('catalog.form.category')}
                  </label>
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-400">
                    {t('catalog.form.turnaround_hours')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={turnaroundHours}
                    onChange={(e) => setTurnaroundHours(e.target.value)}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-400">
                    {t('catalog.form.result_type')}
                  </label>
                  <select
                    value={resultType}
                    onChange={(e) =>
                      setResultType(e.target.value as ResultType)
                    }
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                  >
                    <option value="">
                      {t('catalog.form.result_type_none')}
                    </option>
                    {RESULT_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {t(`catalog.result_type.${rt}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-400">
                    {t('catalog.form.unit')}
                  </label>
                  <input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder={t('catalog.form.unit_placeholder')}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {kind === 'PACKAGE' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('catalog.form.description')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('catalog.form.components')}
                </label>
                <p className="mb-1.5 text-xs text-gray-500">
                  {t('catalog.form.components_hint')}
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-2">
                  {availableTests.length === 0 && (
                    <p className="px-2 py-1 text-xs text-gray-500">
                      {t('catalog.form.no_tests')}
                    </p>
                  )}
                  {availableTests.map((testItem) => (
                    <label
                      key={testItem.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700"
                    >
                      <input
                        type="checkbox"
                        checked={componentIds.includes(testItem.id)}
                        onChange={() => toggleComponent(testItem.id)}
                        className="rounded border-gray-600 bg-gray-900 text-cyan focus:ring-cyan"
                      />
                      {testItem.name}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {formError && (
            <p className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? t('catalog.form.submitting')
                : t('catalog.form.submit')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {t('catalog.form.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
