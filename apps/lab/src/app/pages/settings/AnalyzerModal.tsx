import { useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { useToast } from '../../shared/components/ToastProvider';
import type { Analyzer, Department } from '../../types/lab.types';

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

interface AnalyzerModalProps {
  open: boolean;
  onClose: () => void;
  analyzer: Analyzer | null;
}

export function AnalyzerModal({ open, onClose, analyzer }: AnalyzerModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isEdit = analyzer !== null;

  const [name, setName] = useState(analyzer?.name ?? '');
  const [model, setModel] = useState(analyzer?.model ?? '');
  const [manufacturer, setManufacturer] = useState(
    analyzer?.manufacturer ?? ''
  );
  const [department, setDepartment] = useState<Department>(
    analyzer?.department ?? 'HEMATOLOGY'
  );

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const payload: Record<string, unknown> = {
      name,
      model: model || null,
      manufacturer: manufacturer || null,
      department,
    };

    try {
      if (isEdit) {
        await labApi.analyzers.update(analyzer.id, payload);
        toast.success(t('analyzers.updated'));
      } else {
        await labApi.analyzers.create(payload);
        toast.success(t('analyzers.created'));
      }
      queryClient.invalidateQueries({ queryKey: ['analyzers'] });
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
            {isEdit ? t('analyzers.edit') : t('analyzers.add')}
          </h2>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('analyzers.name')} *
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
              {t('analyzers.model_label')}
            </label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('analyzers.manufacturer')}
            </label>
            <input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              {t('analyzers.department_label')} *
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
