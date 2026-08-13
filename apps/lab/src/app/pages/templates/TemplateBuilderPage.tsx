import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Upload,
  GripVertical,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import type {
  TemplateSection,
  TemplateAnalyte,
  AnalyteValueType,
} from '../../types/lab.types';

const VALUE_TYPE_OPTIONS: AnalyteValueType[] = [
  'NUMERIC',
  'TEXT',
  'LONG_TEXT',
  'POSITIVE_NEGATIVE',
  'SELECT',
];

interface SectionFormState {
  id: string;
  name: string;
  sortOrder: number;
  collapsed: boolean;
  analytes: AnalyteFormState[];
}

interface AnalyteFormState {
  id: string;
  code: string;
  name: string;
  valueType: AnalyteValueType;
  unit: string;
  technique: string;
  isHeader: boolean;
  sortOrder: number;
  options: string[];
  formula: string;
  refMin: string;
  refMax: string;
  refDisplay: string;
}

function newAnalyteId(): string {
  return `new-${crypto.randomUUID()}`;
}

function newSectionId(): string {
  return `new-${crypto.randomUUID()}`;
}

function toAnalyteForm(a: TemplateAnalyte): AnalyteFormState {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    valueType: a.valueType,
    unit: a.unit ?? '',
    technique: a.technique ?? '',
    isHeader: a.isHeader,
    sortOrder: a.sortOrder,
    options: a.options,
    formula: a.formula ?? '',
    refMin: a.referenceRange?.min != null ? String(a.referenceRange.min) : '',
    refMax: a.referenceRange?.max != null ? String(a.referenceRange.max) : '',
    refDisplay: a.referenceRange?.displayText ?? '',
  };
}

function toSectionForm(s: TemplateSection): SectionFormState {
  return {
    id: s.id,
    name: s.name,
    sortOrder: s.sortOrder,
    collapsed: false,
    analytes: s.analytes.map(toAnalyteForm),
  };
}

export function TemplateBuilderPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const { definitionId, versionId } = useParams<{
    definitionId: string;
    versionId: string;
  }>();

  const { data: definition, isLoading } = useQuery({
    queryKey: ['templates', definitionId],
    queryFn: () => labApi.templates.getById(definitionId!),
    enabled: !!definitionId,
  });

  const version =
    definition?.versions?.find((v) => v.id === versionId) ??
    (definition?.activeVersion?.id === versionId
      ? definition?.activeVersion
      : null);

  const [title, setTitle] = useState('');
  const [defaultObservations, setDefaultObservations] = useState('');
  const [sections, setSections] = useState<SectionFormState[]>([]);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!version || initialized) return;

    setTitle(version.title);
    setDefaultObservations(version.defaultObservations ?? '');

    if (version.sections && version.sections.length > 0) {
      setSections(version.sections.map(toSectionForm));
    } else if (version.analytes && version.analytes.length > 0) {
      // Analytes without sections — place them in a default section
      setSections([
        {
          id: newSectionId(),
          name: '',
          sortOrder: 0,
          collapsed: false,
          analytes: version.analytes.map(toAnalyteForm),
        },
      ]);
    } else {
      setSections([]);
    }

    setInitialized(true);
  }, [version, initialized]);

  const updateSection = useCallback(
    (sectionId: string, updates: Partial<SectionFormState>) => {
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, ...updates } : s))
      );
    },
    []
  );

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      {
        id: newSectionId(),
        name: '',
        sortOrder: prev.length,
        collapsed: false,
        analytes: [],
      },
    ]);
  };

  const removeSection = (sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  };

  const toggleSection = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, collapsed: !s.collapsed } : s
      )
    );
  };

  const addAnalyte = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          analytes: [
            ...s.analytes,
            {
              id: newAnalyteId(),
              code: '',
              name: '',
              valueType: 'NUMERIC' as AnalyteValueType,
              unit: '',
              technique: '',
              isHeader: false,
              sortOrder: s.analytes.length,
              options: [],
              formula: '',
              refMin: '',
              refMax: '',
              refDisplay: '',
            },
          ],
        };
      })
    );
  };

  const removeAnalyte = (sectionId: string, analyteId: string) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          analytes: s.analytes.filter((a) => a.id !== analyteId),
        };
      })
    );
  };

  const updateAnalyte = (
    sectionId: string,
    analyteId: string,
    updates: Partial<AnalyteFormState>
  ) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          analytes: s.analytes.map((a) =>
            a.id === analyteId ? { ...a, ...updates } : a
          ),
        };
      })
    );
  };

  const buildPayload = () => {
    return {
      title,
      defaultObservations: defaultObservations || null,
      sections: sections.map((s, si) => ({
        id: s.id.startsWith('new-') ? undefined : s.id,
        name: s.name,
        sortOrder: si,
        analytes: s.analytes.map((a, ai) => ({
          id: a.id.startsWith('new-') ? undefined : a.id,
          code: a.code,
          name: a.name,
          valueType: a.valueType,
          unit: a.unit || null,
          technique: a.technique || null,
          isHeader: a.isHeader,
          sortOrder: ai,
          options: a.options,
          formula: a.formula || null,
          referenceRange:
            a.valueType === 'NUMERIC' && (a.refMin || a.refMax || a.refDisplay)
              ? {
                  min: a.refMin ? Number(a.refMin) : undefined,
                  max: a.refMax ? Number(a.refMax) : undefined,
                  displayText: a.refDisplay,
                }
              : null,
        })),
      })),
    };
  };

  const handleSave = async () => {
    if (!versionId) return;
    setSaving(true);
    try {
      await labApi.templates.updateDraft(versionId, buildPayload());
      toast.success(t('templates.saved_success'));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!versionId) return;
    try {
      const confirmed = await confirm({
        title: t('templates.confirm_publish'),
        message: t('templates.confirm_publish'),
        confirmLabel: t('templates.publish'),
        variant: 'default',
        icon: Upload,
        onConfirm: async () => {
          await labApi.templates.updateDraft(versionId, buildPayload());
          await labApi.templates.publish(versionId);
        },
      });
      if (!confirmed) return;
      toast.success(t('templates.published_success'));
      navigate('/templates');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // Non-admin guard
  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="py-16 text-center text-gray-500">
          {t('common.no_results')}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-800 bg-gray-900 p-5"
            >
              <div className="h-4 w-64 animate-pulse rounded bg-gray-700" />
              <div className="mt-3 h-3 w-40 animate-pulse rounded bg-gray-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!definition || !version) {
    return (
      <div className="p-6">
        <div className="py-16 text-center text-gray-500">
          {t('common.no_results')}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/templates')}
            className="flex items-center gap-1 text-sm text-gray-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            {t('templates.back')}
          </button>
          <h1 className="text-xl font-bold text-white">
            {t('templates.builder_title')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('templates.save')}
          </button>
          <button
            onClick={handlePublish}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            {t('templates.publish')}
          </button>
        </div>
      </div>

      {/* Title & Observations */}
      <div className="mb-6 space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            {t('templates.builder_title')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition focus:border-gray-600"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            {t('templates.default_observations')}
          </label>
          <textarea
            value={defaultObservations}
            onChange={(e) => setDefaultObservations(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition focus:border-gray-600"
          />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((section) => (
          <div
            key={section.id}
            className="rounded-xl border border-gray-800 bg-gray-900"
          >
            {/* Section header */}
            <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-3">
              <GripVertical
                size={16}
                className="shrink-0 cursor-grab text-gray-600"
              />
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="shrink-0 text-gray-400 transition hover:text-white"
              >
                {section.collapsed ? (
                  <ChevronRight size={18} />
                ) : (
                  <ChevronDown size={18} />
                )}
              </button>
              <input
                type="text"
                value={section.name}
                onChange={(e) =>
                  updateSection(section.id, { name: e.target.value })
                }
                placeholder={t('templates.section_name')}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-white placeholder-gray-500 outline-none transition focus:border-gray-700 focus:bg-gray-950"
              />
              <span className="text-xs text-gray-500">
                {section.analytes.length}{' '}
                {section.analytes.length === 1 ? 'analyte' : 'analytes'}
              </span>
              <button
                type="button"
                onClick={() => removeSection(section.id)}
                className="text-gray-500 transition hover:text-red-400"
                title={t('templates.remove_section')}
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* Section body — analytes */}
            {!section.collapsed && (
              <div className="p-4">
                {section.analytes.length > 0 && (
                  <div className="mb-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase text-gray-500">
                          <th className="pb-2 pr-2">
                            {t('templates.analyte_code')}
                          </th>
                          <th className="pb-2 pr-2">
                            {t('templates.analyte_name')}
                          </th>
                          <th className="pb-2 pr-2">
                            {t('templates.analyte_value_type')}
                          </th>
                          <th className="pb-2 pr-2">
                            {t('templates.analyte_unit')}
                          </th>
                          <th className="pb-2 pr-2">
                            {t('templates.analyte_technique')}
                          </th>
                          <th className="pb-2 pr-2 text-center">
                            {t('templates.analyte_is_header')}
                          </th>
                          <th className="pb-2 pr-2 text-center">
                            {t('templates.analyte_sort_order')}
                          </th>
                          <th className="pb-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {section.analytes.map((analyte) => (
                          <AnalyteRow
                            key={analyte.id}
                            analyte={analyte}
                            sectionId={section.id}
                            onUpdate={updateAnalyte}
                            onRemove={removeAnalyte}
                            t={t}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => addAnalyte(section.id)}
                  className="flex items-center gap-1 text-xs font-medium text-cyan transition hover:opacity-80"
                >
                  <Plus size={14} />
                  {t('templates.add_analyte')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={addSection}
          className="flex items-center gap-1 rounded-lg border border-dashed border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-400 transition hover:border-gray-600 hover:text-white"
        >
          <Plus size={16} />
          {t('templates.add_section')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AnalyteRow — extracted for readability                            */
/* ------------------------------------------------------------------ */

interface AnalyteRowProps {
  analyte: AnalyteFormState;
  sectionId: string;
  onUpdate: (
    sectionId: string,
    analyteId: string,
    updates: Partial<AnalyteFormState>
  ) => void;
  onRemove: (sectionId: string, analyteId: string) => void;
  t: (key: string) => string;
}

function AnalyteRow({
  analyte,
  sectionId,
  onUpdate,
  onRemove,
  t,
}: AnalyteRowProps) {
  const cellClass =
    'rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white outline-none transition focus:border-gray-600';

  return (
    <>
      <tr className="border-b border-gray-800/50">
        <td className="py-1.5 pr-2">
          <input
            type="text"
            value={analyte.code}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, { code: e.target.value })
            }
            className={`${cellClass} w-24`}
          />
        </td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            value={analyte.name}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, { name: e.target.value })
            }
            className={`${cellClass} w-36`}
          />
        </td>
        <td className="py-1.5 pr-2">
          <select
            value={analyte.valueType}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, {
                valueType: e.target.value as AnalyteValueType,
              })
            }
            className={`${cellClass} w-32`}
          >
            {VALUE_TYPE_OPTIONS.map((vt) => (
              <option key={vt} value={vt}>
                {vt}
              </option>
            ))}
          </select>
        </td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            value={analyte.unit}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, { unit: e.target.value })
            }
            className={`${cellClass} w-20`}
          />
        </td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            value={analyte.technique}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, { technique: e.target.value })
            }
            className={`${cellClass} w-28`}
          />
        </td>
        <td className="py-1.5 pr-2 text-center">
          <input
            type="checkbox"
            checked={analyte.isHeader}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, { isHeader: e.target.checked })
            }
            className="h-4 w-4 rounded border-gray-600 bg-gray-950 text-cyan accent-cyan"
          />
        </td>
        <td className="py-1.5 pr-2 text-center">
          <input
            type="number"
            value={analyte.sortOrder}
            onChange={(e) =>
              onUpdate(sectionId, analyte.id, {
                sortOrder: Number(e.target.value),
              })
            }
            className={`${cellClass} w-16 text-center`}
          />
        </td>
        <td className="py-1.5">
          <button
            type="button"
            onClick={() => onRemove(sectionId, analyte.id)}
            className="text-gray-500 transition hover:text-red-400"
            title={t('templates.remove_analyte')}
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {analyte.valueType === 'NUMERIC' && (
        <tr className="border-b border-gray-800/50">
          <td colSpan={8} className="pb-2 pl-6 pt-1">
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <label className="flex items-center gap-1">
                {t('templates.ref_min')}
                <input
                  type="number"
                  value={analyte.refMin}
                  onChange={(e) =>
                    onUpdate(sectionId, analyte.id, { refMin: e.target.value })
                  }
                  className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none transition focus:border-gray-600"
                />
              </label>
              <label className="flex items-center gap-1">
                {t('templates.ref_max')}
                <input
                  type="number"
                  value={analyte.refMax}
                  onChange={(e) =>
                    onUpdate(sectionId, analyte.id, { refMax: e.target.value })
                  }
                  className="w-20 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none transition focus:border-gray-600"
                />
              </label>
              <label className="flex items-center gap-1">
                {t('templates.ref_display')}
                <input
                  type="text"
                  value={analyte.refDisplay}
                  onChange={(e) =>
                    onUpdate(sectionId, analyte.id, {
                      refDisplay: e.target.value,
                    })
                  }
                  className="w-36 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none transition focus:border-gray-600"
                />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
