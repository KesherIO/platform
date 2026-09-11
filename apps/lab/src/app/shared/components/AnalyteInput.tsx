import { Combobox } from './Combobox';

export type AnalyteData = {
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
};

export type AnalyteValue = {
  numericValue?: number | null;
  textValue?: string | null;
  booleanValue?: boolean | null;
  selectValue?: string | null;
};

interface AnalyteInputProps {
  analyte: AnalyteData;
  value: AnalyteValue;
  formulaResult?: number | null;
  isReadOnly: boolean;
  onChange: (analyteId: string, value: AnalyteValue) => void;
}

export function AnalyteInput({
  analyte,
  value,
  formulaResult,
  isReadOnly,
  onChange,
}: AnalyteInputProps) {
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

  const refRange = analyte.referenceRange;
  const numVal = analyte.formula
    ? formulaResult ?? null
    : value.numericValue ?? null;
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

  const update = (patch: Partial<AnalyteValue>) =>
    onChange(analyte.id, { ...value, ...patch });

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 border-b border-gray-800/60 last:border-0">
      <div>
        <p className="text-sm text-gray-200">{analyte.name}</p>
        {analyte.technique && (
          <p className="text-xs text-gray-500">{analyte.technique}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {analyte.formula ? (
          <>
            <input
              type="number"
              readOnly
              placeholder="—"
              value={formulaResult ?? ''}
              className={`w-24 rounded-lg border border-gray-700 bg-gray-800/50 px-2 py-1.5 text-right text-sm text-gray-400 focus:outline-none ${
                isHigh || isLow ? flagColor : ''
              }`}
            />
            {formulaResult == null && (
              <span className="text-[10px] text-gray-600 max-w-[120px] leading-tight">
                Requiere:{' '}
                {(analyte.formula.match(/\[([^\]]+)\]/g) ?? [])
                  .map((r) => r.slice(1, -1))
                  .join(', ')}
              </span>
            )}
          </>
        ) : analyte.valueType === 'NUMERIC' ? (
          <input
            type="number"
            step="any"
            readOnly={isReadOnly}
            value={value.numericValue ?? ''}
            onChange={(e) =>
              update({
                numericValue:
                  e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className={`w-24 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm text-white focus:border-cyan focus:outline-none ${
              isReadOnly ? 'opacity-60' : ''
            } ${isHigh || isLow ? flagColor : ''}`}
          />
        ) : analyte.valueType === 'TEXT' ? (
          analyte.options.length > 0 ? (
            <Combobox
              value={value.textValue ?? ''}
              options={analyte.options}
              readOnly={isReadOnly}
              onChange={(v) => update({ textValue: v || null })}
              className={`w-40 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none ${
                isReadOnly ? 'opacity-60' : ''
              }`}
            />
          ) : (
            <input
              type="text"
              readOnly={isReadOnly}
              value={value.textValue ?? ''}
              onChange={(e) => update({ textValue: e.target.value || null })}
              className={`w-40 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none ${
                isReadOnly ? 'opacity-60' : ''
              }`}
            />
          )
        ) : analyte.valueType === 'LONG_TEXT' ? (
          analyte.options.length > 0 ? (
            <Combobox
              value={value.textValue ?? ''}
              options={analyte.options}
              readOnly={isReadOnly}
              multiLine
              onChange={(v) => update({ textValue: v || null })}
              className={`w-56 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none ${
                isReadOnly ? 'opacity-60' : ''
              }`}
            />
          ) : (
            <textarea
              readOnly={isReadOnly}
              rows={3}
              value={value.textValue ?? ''}
              onChange={(e) => update({ textValue: e.target.value || null })}
              className={`w-56 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-cyan focus:outline-none resize-none ${
                isReadOnly ? 'opacity-60' : ''
              }`}
            />
          )
        ) : analyte.valueType === 'SELECT' ? (
          <select
            disabled={isReadOnly}
            value={value.selectValue ?? ''}
            onChange={(e) => update({ selectValue: e.target.value || null })}
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
        ) : analyte.valueType === 'POSITIVE_NEGATIVE' ? (
          <div className="flex gap-1">
            {['Positivo', 'Negativo'].map((opt) => {
              const isPos = opt === 'Positivo';
              const selected = value.booleanValue === isPos;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() =>
                    update({ booleanValue: selected ? null : isPos })
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
}
