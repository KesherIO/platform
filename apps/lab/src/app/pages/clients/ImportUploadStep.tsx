import { useRef, useState, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileDown } from 'lucide-react';
import { COUNTRY_CODES, countryName } from '../../shared/countries';
import { CLIENT_TYPES, templateCsv } from '../../shared/clientImport';
import {
  MAX_IMPORT_ROWS,
  SpreadsheetParseError,
  readSpreadsheet,
} from '../../shared/spreadsheet';
import { downloadCsv } from './importLabels';
import type { TemplateHeaders } from '../../shared/clientImport';
import type { ClientType, ParsedSheet } from '../../types/lab.types';

interface Props {
  defaults: { clientType: ClientType; country: string };
  onDefaultsChange: (defaults: {
    clientType: ClientType;
    country: string;
  }) => void;
  labHasCountry: boolean;
  templateHeaders: TemplateHeaders;
  sheet: ParsedSheet | null;
  fileName: string | null;
  onFileParsed: (sheet: ParsedSheet, fileName: string) => void;
}

const SELECT_CLASS =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none';

export function ImportUploadStep({
  defaults,
  onDefaultsChange,
  labHasCountry,
  templateHeaders,
  sheet,
  fileName,
  onFileParsed,
}: Props) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      onFileParsed(await readSpreadsheet(file), file.name);
    } catch (err) {
      const code =
        err instanceof SpreadsheetParseError ? err.code : 'UNREADABLE_FILE';
      setError(t(`clients.import.errors.${code}`, { max: MAX_IMPORT_ROWS }));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        {t('clients.import.upload.description')}
      </p>

      <div className="rounded-xl border border-dashed border-gray-700 p-5 text-center">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={reading}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {reading
            ? t('clients.import.upload.reading')
            : t('clients.import.upload.choose_file')}
        </button>
        <p className="mt-2 text-xs text-gray-500">
          {t('clients.import.upload.file_types', { max: MAX_IMPORT_ROWS })}
        </p>
        {sheet && fileName && !error && (
          <p className="mt-3 text-sm text-green-300">
            {t('clients.import.upload.rows_found', {
              count: sheet.rows.length,
              file: fileName,
            })}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() =>
          downloadCsv(
            templateCsv(templateHeaders),
            t('clients.import.upload.template_filename')
          )
        }
        className="inline-flex items-center gap-1.5 text-xs text-cyan hover:underline"
      >
        <FileDown className="h-3.5 w-3.5" />
        {t('clients.import.upload.template')}
      </button>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            {t('clients.import.upload.default_client_type')}
          </label>
          <select
            value={defaults.clientType}
            onChange={(e) =>
              onDefaultsChange({
                ...defaults,
                clientType: e.target.value as ClientType,
              })
            }
            className={SELECT_CLASS}
          >
            {CLIENT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t(`clients.type.${ct}`)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {t('clients.import.upload.default_client_type_hint')}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            {t('clients.import.upload.default_country')}
          </label>
          <select
            value={defaults.country}
            onChange={(e) =>
              onDefaultsChange({ ...defaults, country: e.target.value })
            }
            className={SELECT_CLASS}
          >
            <option value="">{t('clients.form.country_placeholder')}</option>
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {countryName(code, i18n.language)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {labHasCountry
              ? t('clients.import.upload.default_country_hint')
              : t('clients.import.upload.no_lab_country')}
          </p>
        </div>
      </div>
    </div>
  );
}
