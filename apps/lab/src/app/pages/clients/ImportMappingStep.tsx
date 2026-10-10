import { useTranslation } from 'react-i18next';
import {
  IMPORT_FIELDS,
  mappingProblems,
  sampleValues,
  setColumnMapping,
} from '../../shared/clientImport';
import type { ColumnMapping, ParsedSheet } from '../../types/lab.types';

interface Props {
  sheet: ParsedSheet;
  mapping: ColumnMapping[];
  /** Mapping suggested when the file was loaded, to mark suggestions */
  suggested: ColumnMapping[];
  onChange: (mapping: ColumnMapping[]) => void;
}

/** One line per file column: header, sample values, field select (A8). */
export function ImportMappingStep({
  sheet,
  mapping,
  suggested,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const problems = mappingProblems(mapping);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {t('clients.import.mapping.description')}
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.mapping.column')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.mapping.samples')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('clients.import.mapping.field')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sheet.headers.map((header, col) => (
              <tr key={col} className="align-top">
                <td className="px-3 py-2 font-medium text-white">
                  {header || `#${col + 1}`}
                </td>
                <td className="max-w-xs px-3 py-2 text-xs text-gray-400">
                  {sampleValues(sheet, col).map((v, i) => (
                    <div key={i} className="truncate">
                      {v}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={mapping[col]}
                    onChange={(e) =>
                      onChange(
                        setColumnMapping(
                          mapping,
                          col,
                          e.target.value as ColumnMapping
                        )
                      )
                    }
                    className={`w-full rounded-lg border bg-gray-800 px-2 py-1.5 text-sm focus:border-cyan focus:outline-none ${
                      mapping[col] === 'ignore'
                        ? 'border-gray-700 text-gray-500'
                        : 'border-cyan/40 text-white'
                    }`}
                  >
                    <option value="ignore">
                      {t('clients.import.mapping.ignore')}
                    </option>
                    {IMPORT_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {t(`clients.import.fields.${field}`)}
                      </option>
                    ))}
                  </select>
                  {mapping[col] !== 'ignore' &&
                    mapping[col] === suggested[col] && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        {t('clients.import.mapping.suggested')}
                      </p>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        {t('clients.import.mapping.notes_hint')}
      </p>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-yellow-900/20 px-3 py-2 text-xs text-yellow-300">
          {problems.map((p) => (
            <li key={p}>{t(`clients.import.mapping.${p}`)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
