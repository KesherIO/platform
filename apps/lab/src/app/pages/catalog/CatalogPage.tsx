import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Power, Upload, FileDown, ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { IconActionButton } from '../../shared/components/IconActionButton';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import { CatalogItemModal } from './CatalogItemModal';
import { CatalogGuidelines } from './CatalogGuidelines';
import type {
  CatalogCounts,
  CatalogItem,
  ImportCatalogItemInput,
  ReadinessResult,
} from '../../types/lab.types';

const STATUS_COLORS: Record<'active' | 'inactive', string> = {
  active: 'bg-green-900/30 text-green-300',
  inactive: 'bg-red-900/30 text-red-300',
};

const KIND_COLORS: Record<CatalogItem['kind'], string> = {
  TEST: 'bg-cyan/10 text-cyan',
  PACKAGE: 'bg-purple/10 text-purple',
};

type KindFilter = 'ALL' | CatalogItem['kind'];

const KIND_FILTERS: Array<{
  key: KindFilter;
  labelKey: string;
  countKey: keyof CatalogCounts;
}> = [
  { key: 'ALL', labelKey: 'catalog.filter.all', countKey: 'all' },
  { key: 'TEST', labelKey: 'catalog.filter.tests', countKey: 'TEST' },
  {
    key: 'PACKAGE',
    labelKey: 'catalog.filter.packages',
    countKey: 'PACKAGE',
  },
];

const EMPTY_COUNTS: CatalogCounts = { all: 0, TEST: 0, PACKAGE: 0 };

const CSV_HEADERS = [
  'kind',
  'code',
  'name',
  'category',
  'turnaroundHours',
  'resultType',
  'unit',
  'description',
  'componentCodes',
] as const;

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsvToItems(text: string): Record<string, unknown>[] | string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) return 'catalog.import_file.invalid_csv';

  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const kindIdx = headers.indexOf('kind');
  const nameIdx = headers.indexOf('name');

  if (kindIdx === -1 || nameIdx === -1) {
    return 'catalog.import_file.csv_missing_headers';
  }

  const items: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    const item: Record<string, unknown> = {};

    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = values[j] ?? '';
      if (!value) continue;

      if (header === 'kind') {
        item.kind = value.toUpperCase();
      } else if (header === 'turnaroundhours') {
        const n = parseInt(value, 10);
        if (!isNaN(n)) item.turnaroundHours = n;
      } else if (header === 'componentcodes') {
        item.componentCodes = value
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean);
      } else if (header === 'resulttype') {
        item.resultType = value;
      } else {
        item[header] = value;
      }
    }

    items.push(item);
  }

  return items;
}

export function CatalogPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!importMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(e.target as Node)
      ) {
        setImportMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImportMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [importMenuOpen]);

  const pageSize = 20;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['catalog', { search, kind: kindFilter, page }],
    queryFn: () =>
      labApi.catalog.list({
        search: search || undefined,
        kind: kindFilter === 'ALL' ? undefined : kindFilter,
        page,
        pageSize,
      }),
  });

  const { data: readinessData } = useQuery({
    queryKey: ['catalog-readiness'],
    queryFn: () => labApi.readiness.bulk(),
    staleTime: 60_000,
  });

  const readinessMap = new Map(
    (readinessData?.items ?? []).map((r) => [r.catalogItemId, r])
  );

  const items = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const counts = data?.counts ?? EMPTY_COUNTS;

  useEffect(() => {
    setPage(1);
  }, [search, kindFilter]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const handleToggleActive = async (item: CatalogItem) => {
    if (item.active) {
      try {
        const confirmed = await confirm({
          title: t('catalog.disable_title'),
          message: t('catalog.disable_confirm', { name: item.name }),
          confirmLabel: t('catalog.actions.disable'),
          variant: 'destructive',
          icon: Power,
          onConfirm: () => labApi.catalog.disable(item.id),
        });
        if (!confirmed) return;
      } catch (err) {
        toast.error(`${t('catalog.errors.disable')} ${(err as Error).message}`);
        return;
      }
    } else {
      try {
        await labApi.catalog.enable(item.id);
      } catch (err) {
        toast.error(`${t('catalog.errors.enable')} ${(err as Error).message}`);
        return;
      }
    }
    loadCatalog();
  };

  const loadCatalog = () => {
    queryClient.invalidateQueries({ queryKey: ['catalog'] });
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const text = await file.text();
    const isCsv = file.name.toLowerCase().endsWith('.csv');

    let items: unknown[];

    if (isCsv) {
      const parsed = parseCsvToItems(text);
      if (typeof parsed === 'string') {
        toast.error(t(parsed));
        return;
      }
      items = parsed;
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast.error(t('catalog.import_file.invalid_json'));
        return;
      }

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray((parsed as Record<string, unknown>).items)
      ) {
        toast.error(t('catalog.import_file.missing_items'));
        return;
      }

      items = (parsed as { items: unknown[] }).items;
    }

    if (items.length === 0) {
      toast.error(t('catalog.import_file.empty_items'));
      return;
    }

    const validKinds = new Set(['TEST', 'PACKAGE']);
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        toast.error(t('catalog.import_file.invalid_item', { index: i + 1 }));
        return;
      }
      if (!validKinds.has(item.kind as string)) {
        toast.error(t('catalog.import_file.invalid_kind', { index: i + 1 }));
        return;
      }
      if (typeof item.name !== 'string' || !item.name.trim()) {
        toast.error(t('catalog.import_file.missing_name', { index: i + 1 }));
        return;
      }
    }

    const testCount = items.filter(
      (i) => (i as Record<string, unknown>).kind === 'TEST'
    ).length;
    const packageCount = items.filter(
      (i) => (i as Record<string, unknown>).kind === 'PACKAGE'
    ).length;

    const confirmed = await confirm({
      title: t('catalog.import_file.confirm_title'),
      message: t('catalog.import_file.confirm_message', {
        total: items.length,
        tests: testCount,
        packages: packageCount,
      }),
      confirmLabel: t('catalog.import_file.confirm_button'),
      icon: Upload,
    });
    if (!confirmed) return;

    setImporting(true);
    try {
      const result = await labApi.catalog.importCatalog({
        items: items as ImportCatalogItemInput[],
      });
      toast.success(
        t('catalog.import_file.success', {
          created: result.created,
          updated: result.updated,
        })
      );
      loadCatalog();
    } catch (err) {
      toast.error(
        `${t('catalog.import_file.error')} ${(err as Error).message}`
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadCsvTemplate = () => {
    const header = CSV_HEADERS.join(',');
    const rows = [
      'TEST,EXAMPLE-001,Example Test,Hematology,4,NUMERIC,mg/dL,,',
      'PACKAGE,PKG-001,Example Package,Chemistry,,,,,EXAMPLE-001',
    ];
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalog-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    setImportMenuOpen(false);
  };

  const handleDownloadJsonTemplate = () => {
    const template = {
      items: [
        {
          kind: 'TEST',
          code: 'EXAMPLE-001',
          name: 'Example Test',
          category: 'Hematology',
          turnaroundHours: 4,
          resultType: 'NUMERIC',
          unit: 'mg/dL',
        },
        {
          kind: 'PACKAGE',
          code: 'PKG-001',
          name: 'Example Package',
          category: 'Chemistry',
          description: 'A sample package bundling tests',
          componentCodes: ['EXAMPLE-001'],
        },
      ],
    };
    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalog-template.json';
    a.click();
    URL.revokeObjectURL(url);
    setImportMenuOpen(false);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">
              {t('catalog.title')}
            </h1>
          </div>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {total} {t('catalog.subtitle')}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <CatalogGuidelines />
            <div className="relative" ref={importMenuRef}>
              <button
                onClick={() => setImportMenuOpen(!importMenuOpen)}
                disabled={importing}
                aria-expanded={importMenuOpen}
                aria-haspopup="true"
                className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 pl-3 pr-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                <Upload size={14} />
                {importing
                  ? t('catalog.import_file.importing')
                  : t('catalog.import_file.button')}
                <ChevronDown
                  size={14}
                  className={`text-gray-400 transition-transform ${
                    importMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {importMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setImportMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
                  >
                    <Upload size={15} strokeWidth={2} />
                    {t('catalog.import_file.import_from_file')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCsvTemplate}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
                  >
                    <FileDown size={15} strokeWidth={2} />
                    {t('catalog.import_file.download_csv')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadJsonTemplate}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
                  >
                    <FileDown size={15} strokeWidth={2} />
                    {t('catalog.import_file.download_json')}
                  </button>
                  <div className="border-t border-gray-800 px-3 py-2">
                    <p className="text-[11px] text-gray-500">
                      {t('catalog.import_file.format_hint')}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              onClick={() => setShowCreateModal(true)}
              className="h-9 rounded-lg bg-cyan px-4 text-sm font-semibold text-gray-950 hover:opacity-90"
            >
              + {t('catalog.create')}
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('catalog.search_placeholder')}
          />
        </div>
        <div className="flex gap-1.5">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setKindFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                kindFilter === f.key
                  ? 'bg-cyan/20 text-cyan'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {t(f.labelKey)} {counts[f.countKey]}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
            >
              <div className="space-y-2">
                <div className="h-4 w-48 animate-pulse rounded bg-gray-700" />
                <div className="h-3 w-32 animate-pulse rounded bg-gray-800" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-gray-700" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {t('catalog.error')}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {search || kindFilter !== 'ALL'
            ? t('catalog.no_matches')
            : t('catalog.empty')}
        </div>
      )}

      {!error && items.length > 0 && (
        <div
          className={`transition-opacity ${
            isFetching ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="space-y-2">
            {items.map((item) => {
              const readiness = readinessMap.get(item.id);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-white">
                      <span className="truncate">{item.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          KIND_COLORS[item.kind]
                        }`}
                      >
                        {t(`catalog.kind.${item.kind}`)}
                      </span>
                      {item.kind === 'TEST' && readiness && (
                        <span
                          title={
                            readiness.ready
                              ? t('catalog.readiness.ready')
                              : readiness.reasons
                                  .map((r) => r.message)
                                  .join(', ')
                          }
                          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                            readiness.ready ? 'bg-green-400' : 'bg-red-400'
                          }`}
                        />
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {item.code}
                      {item.code && item.category && ' · '}
                      {item.category}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <div className="w-44 text-right">
                      <p className="text-xs text-gray-500">
                        {t('catalog.columns.created')}:{' '}
                        {formatDate(item.createdAt)}
                      </p>
                      <p className="text-xs text-gray-600">
                        {t('catalog.columns.updated')}:{' '}
                        {formatDate(item.updatedAt)}
                      </p>
                    </div>
                    <div className="w-20 text-center">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                          STATUS_COLORS[item.active ? 'active' : 'inactive']
                        }`}
                      >
                        {t(
                          item.active
                            ? 'catalog.status.active'
                            : 'catalog.status.inactive'
                        )}
                      </span>
                    </div>
                    {isAdmin && (
                      <div className="flex w-24 items-center justify-end gap-1">
                        <IconActionButton
                          icon={Pencil}
                          label={t('catalog.actions.edit')}
                          onClick={() => setEditingItem(item)}
                          variant="neutral"
                        />
                        <IconActionButton
                          icon={Power}
                          label={t(
                            item.active
                              ? 'catalog.actions.disable'
                              : 'catalog.actions.enable'
                          )}
                          onClick={() => handleToggleActive(item)}
                          variant={item.active ? 'danger' : 'neutral'}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      )}

      {showCreateModal && (
        <CatalogItemModal
          mode="create"
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            loadCatalog();
          }}
        />
      )}

      {editingItem && (
        <CatalogItemModal
          mode="edit"
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            loadCatalog();
          }}
        />
      )}
    </div>
  );
}
