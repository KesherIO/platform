import { useState, useEffect, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { useToast } from '../../shared/components/ToastProvider';
import type {
  LabTestConfiguration,
  Analyzer,
  Department,
  ProcessingMethod,
  CatalogItem,
} from '../../types/lab.types';

const DEPARTMENTS: Department[] = [
  'HEMATOLOGY',
  'CHEMISTRY',
  'URINALYSIS',
  'PARASITOLOGY',
  'SEROLOGY',
  'ENDOCRINOLOGY',
  'MICROBIOLOGY',
  'OTHER',
];

const PROCESSING_METHODS: ProcessingMethod[] = ['MANUAL', 'ANALYZER'];

interface TestConfigModalProps {
  open: boolean;
  onClose: () => void;
  config: LabTestConfiguration | null;
  analyzers: Analyzer[];
  existingConfigItemIds: string[];
}

export function TestConfigModal({
  open,
  onClose,
  config,
  analyzers,
  existingConfigItemIds,
}: TestConfigModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = config !== null;

  const [catalogItemId, setCatalogItemId] = useState(config?.catalogItemId ?? '');
  const [department, setDepartment] = useState<Department>(config?.department ?? 'HEMATOLOGY');
  const [defaultProcessingMethod, setDefaultProcessingMethod] = useState<ProcessingMethod>(
    config?.defaultProcessingMethod ?? 'MANUAL'
  );
  const [allowedProcessingMethods, setAllowedProcessingMethods] = useState<ProcessingMethod[]>(
    config?.allowedProcessingMethods ?? ['MANUAL']
  );
  const [defaultAnalyzerId, setDefaultAnalyzerId] = useState<string>(
    config?.defaultAnalyzerId ?? ''
  );

  const [availableTests, setAvailableTests] = useState<CatalogItem[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load active catalog items for the dropdown (create mode only)
  useEffect(() => {
    if (isEdit) return;
    setLoadingTests(true);
    labApi.catalog
      .listActive()
      .then((res) => {
        const tests = res.data.filter(
          (item) =>
            item.kind === 'TEST' &&
            item.active &&
            !existingConfigItemIds.includes(item.id)
        );
        setAvailableTests(tests);
      })
      .finally(() => setLoadingTests(false));
  }, [isEdit, existingConfigItemIds]);

  // Filter analyzers by selected department (only active ones)
  const departmentAnalyzers = analyzers.filter(
    (a) => a.department === department && a.isActive
  );

  // Reset default analyzer when department changes and current selection is no longer valid
  useEffect(() => {
    if (defaultAnalyzerId && !departmentAnalyzers.some((a) => a.id === defaultAnalyzerId)) {
      setDefaultAnalyzerId('');
    }
  }, [department, departmentAnalyzers, defaultAnalyzerId]);

  const toggleAllowedMethod = (method: ProcessingMethod) => {
    setAllowedProcessingMethods((prev) => {
      if (prev.includes(method)) {
        // Don't allow removing the last method
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== method);
      }
      return [...prev, method];
    });
  };

  // If the user unchecks the default method from allowed, switch default to the remaining one
  useEffect(() => {
    if (!allowedProcessingMethods.includes(defaultProcessingMethod)) {
      setDefaultProcessingMethod(allowedProcessingMethods[0]);
    }
  }, [allowedProcessingMethods, defaultProcessingMethod]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const payload: Record<string, unknown> = {
      catalogItemId: isEdit ? config.catalogItemId : catalogItemId,
      department,
      defaultProcessingMethod,
      allowedProcessingMethods,
      defaultAnalyzerId: defaultAnalyzerId || null,
    };

    try {
      await labApi.testConfigs.upsert(payload);
      toast.success(t('test_config.saved'));
      queryClient.invalidateQueries({ queryKey: ['testConfigs'] });
      onClose();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="border-b border-gray-800 px-6 py-4">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? t('test_config.edit') : t('test_config.add')}
          </h2>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5"
        >
          {/* Catalog item selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('test_config.test_name')} *
            </label>
            {isEdit ? (
              <input
                disabled
                value={config.catalogItem.name}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
              />
            ) : (
              <select
                required
                value={catalogItemId}
                onChange={(e) => setCatalogItemId(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              >
                <option value="">{t('test_config.select_test')}</option>
                {loadingTests ? (
                  <option disabled>{t('common.loading')}</option>
                ) : (
                  availableTests.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.code ? ` (${item.code})` : ''}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>

          {/* Department */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('test_config.department')} *
            </label>
            <select
              required
              value={department}
              onChange={(e) => setDepartment(e.target.value as Department)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            >
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {t(`analyzers.department.${dept}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Default processing method */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('test_config.processing_method')} *
            </label>
            <div className="flex gap-4">
              {PROCESSING_METHODS.filter((m) =>
                allowedProcessingMethods.includes(m)
              ).map((method) => (
                <label
                  key={method}
                  className="flex items-center gap-2 text-sm text-gray-300"
                >
                  <input
                    type="radio"
                    name="defaultProcessingMethod"
                    value={method}
                    checked={defaultProcessingMethod === method}
                    onChange={() => setDefaultProcessingMethod(method)}
                    className="border-gray-600 bg-gray-900 text-cyan focus:ring-cyan"
                  />
                  {t(`test_config.method.${method}`)}
                </label>
              ))}
            </div>
          </div>

          {/* Allowed processing methods */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('test_config.allowed_methods')} *
            </label>
            <div className="flex gap-4">
              {PROCESSING_METHODS.map((method) => (
                <label
                  key={method}
                  className="flex items-center gap-2 text-sm text-gray-300"
                >
                  <input
                    type="checkbox"
                    checked={allowedProcessingMethods.includes(method)}
                    onChange={() => toggleAllowedMethod(method)}
                    className="rounded border-gray-600 bg-gray-900 text-cyan focus:ring-cyan"
                  />
                  {t(`test_config.method.${method}`)}
                </label>
              ))}
            </div>
          </div>

          {/* Default analyzer */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('test_config.default_analyzer')}
            </label>
            <select
              value={defaultAnalyzerId}
              onChange={(e) => setDefaultAnalyzerId(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
            >
              <option value="">{t('test_config.select_analyzer')}</option>
              {departmentAnalyzers.map((analyzer) => (
                <option key={analyzer.id} value={analyzer.id}>
                  {analyzer.name}
                  {analyzer.model ? ` — ${analyzer.model}` : ''}
                </option>
              ))}
            </select>
            {departmentAnalyzers.length === 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {t('analyzers.no_results')}
              </p>
            )}
          </div>

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
              {submitting ? t('catalog.form.submitting') : t('catalog.form.submit')}
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
