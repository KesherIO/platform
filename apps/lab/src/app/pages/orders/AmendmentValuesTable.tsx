import { useTranslation } from 'react-i18next';
import { Combobox } from '../../shared/components/Combobox';
import type {
  AmendmentAnalyteInfo,
  AmendmentValue,
} from '../../types/lab.types';

export function isSameAmendmentValue(a: AmendmentValue, b: AmendmentValue) {
  return (
    a.numericValue === b.numericValue &&
    (a.textValue ?? '') === (b.textValue ?? '') &&
    a.booleanValue === b.booleanValue &&
    (a.selectValue ?? '') === (b.selectValue ?? '')
  );
}

export function isEditableAmendmentAnalyte(a: AmendmentAnalyteInfo) {
  return !a.isHeader && !a.formula;
}

// Result values are lab content (Spanish, as on the PDF), not UI strings
function displayValue(valueType: string, v: AmendmentValue): string {
  switch (valueType) {
    case 'NUMERIC':
      return v.numericValue != null ? String(v.numericValue) : '—';
    case 'POSITIVE_NEGATIVE':
      return v.booleanValue === true
        ? 'Positivo'
        : v.booleanValue === false
        ? 'Negativo'
        : '—';
    case 'SELECT':
      return v.selectValue || '—';
    default:
      return v.textValue || '—';
  }
}

function numericFlag(
  value: number | null,
  ref: AmendmentAnalyteInfo['referenceSnapshot']
): 'H' | 'L' | null {
  const range = ref as { min?: number; max?: number } | null;
  if (value == null || !range) return null;
  if (range.max != null && value > range.max) return 'H';
  if (range.min != null && value < range.min) return 'L';
  return null;
}

const inputClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none';

function CorrectedInput({
  analyte,
  onChange,
}: {
  analyte: AmendmentAnalyteInfo;
  onChange: (value: AmendmentValue) => void;
}) {
  const update = (patch: Partial<AmendmentValue>) =>
    onChange({
      numericValue: analyte.numericValue,
      textValue: analyte.textValue,
      booleanValue: analyte.booleanValue,
      selectValue: analyte.selectValue,
      ...patch,
    });

  switch (analyte.valueType) {
    case 'NUMERIC':
      return (
        <input
          type="number"
          step="any"
          value={analyte.numericValue ?? ''}
          onChange={(e) =>
            update({
              numericValue:
                e.target.value === '' ? null : Number(e.target.value),
            })
          }
          className={`w-24 text-right ${inputClass}`}
        />
      );
    case 'SELECT':
      return (
        <select
          value={analyte.selectValue ?? ''}
          onChange={(e) => update({ selectValue: e.target.value || null })}
          className={inputClass}
        >
          <option value="">—</option>
          {analyte.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'POSITIVE_NEGATIVE':
      return (
        <div className="flex gap-1">
          {[true, false].map((isPos) => {
            const selected = analyte.booleanValue === isPos;
            return (
              <button
                key={String(isPos)}
                type="button"
                onClick={() =>
                  update({ booleanValue: selected ? null : isPos })
                }
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                  selected
                    ? isPos
                      ? 'border-red-500 bg-red-900/40 text-red-300'
                      : 'border-emerald-500 bg-emerald-900/40 text-emerald-300'
                    : 'border-gray-700 text-gray-500 hover:border-gray-500'
                }`}
              >
                {isPos ? 'Positivo' : 'Negativo'}
              </button>
            );
          })}
        </div>
      );
    case 'LONG_TEXT':
      return analyte.options.length > 0 ? (
        <Combobox
          value={analyte.textValue ?? ''}
          options={analyte.options}
          multiLine
          onChange={(v) => update({ textValue: v || null })}
          className={`w-56 ${inputClass}`}
        />
      ) : (
        <textarea
          rows={3}
          value={analyte.textValue ?? ''}
          onChange={(e) => update({ textValue: e.target.value || null })}
          className={`w-56 resize-none ${inputClass}`}
        />
      );
    default:
      return analyte.options.length > 0 ? (
        <Combobox
          value={analyte.textValue ?? ''}
          options={analyte.options}
          onChange={(v) => update({ textValue: v || null })}
          className={`w-40 ${inputClass}`}
        />
      ) : (
        <input
          type="text"
          value={analyte.textValue ?? ''}
          onChange={(e) => update({ textValue: e.target.value || null })}
          className={`w-40 ${inputClass}`}
        />
      );
  }
}

/**
 * Draft amendment editor: released value next to the corrected value, so the
 * reviewer sees exactly what changed. Formula rows are recalculated on approval.
 * Without `onChange` it is read-only (the reviewer's view while IN_REVIEW).
 */
export function AmendmentValuesTable({
  analytes,
  released,
  onChange,
}: {
  analytes: AmendmentAnalyteInfo[];
  released: Record<string, AmendmentValue>;
  onChange?: (analyteId: string, value: AmendmentValue) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="px-3 py-2 font-medium">
              {t('review.amend_col_analyte')}
            </th>
            <th className="px-3 py-2 font-medium">
              {t('review.amend_col_released')}
            </th>
            <th className="px-3 py-2 font-medium">
              {t('review.amend_col_corrected')}
            </th>
            <th className="px-3 py-2 font-medium">
              {t('review.amend_col_reference')}
            </th>
          </tr>
        </thead>
        <tbody>
          {analytes.map((a) => {
            if (a.isHeader) {
              const label = a.name.trim();
              if (!label || /^-+$/.test(label)) return null;
              return (
                <tr key={a.id}>
                  <td
                    colSpan={4}
                    className="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-gray-400"
                  >
                    {label}
                  </td>
                </tr>
              );
            }

            const original = released[a.id];
            const changed =
              isEditableAmendmentAnalyte(a) &&
              !!original &&
              !isSameAmendmentValue(a, original);
            const flag =
              a.valueType === 'NUMERIC' && !a.formula
                ? numericFlag(a.numericValue, a.referenceSnapshot)
                : null;
            const refText =
              (a.referenceSnapshot as { displayText?: string } | null)
                ?.displayText ?? '';

            return (
              <tr
                key={a.id}
                className={`border-b border-gray-800/40 last:border-0 ${
                  changed ? 'bg-amber-900/15' : ''
                }`}
              >
                <td className="px-3 py-2 text-gray-300">{a.name}</td>
                <td
                  className={`px-3 py-2 whitespace-pre-wrap ${
                    changed ? 'text-gray-500 line-through' : 'text-gray-400'
                  }`}
                >
                  {original ? displayValue(a.valueType, original) : '—'}
                  {a.unit && (
                    <span className="ml-1 text-xs text-gray-600">{a.unit}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {a.formula ? (
                    <span className="text-xs text-gray-500">
                      {t('review.amend_formula_auto')}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      {onChange ? (
                        <CorrectedInput
                          analyte={a}
                          onChange={(value) => onChange(a.id, value)}
                        />
                      ) : (
                        <span
                          className={`whitespace-pre-wrap ${
                            changed
                              ? 'font-semibold text-white'
                              : 'text-gray-300'
                          }`}
                        >
                          {displayValue(a.valueType, a)}
                        </span>
                      )}
                      {a.unit && (
                        <span className="text-xs text-gray-500">{a.unit}</span>
                      )}
                      {flag && (
                        <span
                          className={`text-xs font-semibold ${
                            flag === 'H' ? 'text-red-400' : 'text-blue-400'
                          }`}
                        >
                          {flag === 'H' ? '▲ H' : '▼ L'}
                        </span>
                      )}
                      {changed && (
                        <span className="text-xs text-amber-400">
                          ● {t('review.amend_changed')}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{refText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
