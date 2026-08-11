import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Power } from 'lucide-react';
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
import type { CatalogCounts, CatalogItem } from '../../types/lab.types';

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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">
              {t('catalog.title')}
            </h1>
            <CatalogGuidelines />
          </div>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {total} {t('catalog.subtitle')}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            + {t('catalog.create')}
          </button>
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
            {items.map((item) => (
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
            ))}
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
