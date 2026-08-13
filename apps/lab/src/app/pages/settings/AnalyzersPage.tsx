import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Power, Cpu } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { IconActionButton } from '../../shared/components/IconActionButton';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import { AnalyzerModal } from './AnalyzerModal';
import type { Analyzer } from '../../types/lab.types';

const STATUS_COLORS: Record<'active' | 'inactive', string> = {
  active: 'bg-green-900/30 text-green-300',
  inactive: 'bg-red-900/30 text-red-300',
};

export function AnalyzersPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Analyzer | null>(null);

  const { data: analyzers = [], isLoading, isFetching, error } = useQuery({
    queryKey: ['analyzers'],
    queryFn: () => labApi.analyzers.list(),
  });

  const filtered = useMemo(() => {
    if (!search) return analyzers;
    const q = search.toLowerCase();
    return analyzers.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.model && a.model.toLowerCase().includes(q)) ||
        (a.manufacturer && a.manufacturer.toLowerCase().includes(q))
    );
  }, [analyzers, search]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['analyzers'] });
  };

  const handleToggleActive = async (item: Analyzer) => {
    if (item.isActive) {
      try {
        const confirmed = await confirm({
          title: t('analyzers.confirm_disable'),
          message: t('analyzers.confirm_disable'),
          confirmLabel: t('analyzers.inactive'),
          variant: 'destructive',
          icon: Power,
          onConfirm: () => labApi.analyzers.disable(item.id),
        });
        if (!confirmed) return;
      } catch (err) {
        toast.error((err as Error).message);
        return;
      }
    } else {
      try {
        const confirmed = await confirm({
          title: t('analyzers.confirm_enable'),
          message: t('analyzers.confirm_enable'),
          confirmLabel: t('analyzers.active'),
          variant: 'default',
          icon: Power,
          onConfirm: () => labApi.analyzers.enable(item.id),
        });
        if (!confirmed) return;
      } catch (err) {
        toast.error((err as Error).message);
        return;
      }
    }
    invalidate();
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Cpu size={20} className="text-cyan" />
            <h1 className="text-xl font-bold text-white">
              {t('analyzers.title')}
            </h1>
          </div>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {filtered.length} {t('analyzers.title').toLowerCase()}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            + {t('analyzers.add')}
          </button>
        )}
      </div>

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('analyzers.search_placeholder')}
        />
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
          {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="py-16 text-center text-gray-500">
          {t('analyzers.no_results')}
        </div>
      )}

      {!error && filtered.length > 0 && (
        <div
          className={`transition-opacity ${
            isFetching ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="space-y-2">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-white">
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-medium text-cyan">
                      {t(`analyzers.department.${item.department}`)}
                    </span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {item.model}
                    {item.model && item.manufacturer && ' · '}
                    {item.manufacturer}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <div className="w-44 text-right">
                    <p className="text-xs text-gray-500">
                      {t('analyzers.created')}: {formatDate(item.createdAt)}
                    </p>
                    <p className="text-xs text-gray-600">
                      {t('analyzers.updated')}: {formatDate(item.updatedAt)}
                    </p>
                  </div>
                  <div className="w-20 text-center">
                    <span
                      className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                        STATUS_COLORS[item.isActive ? 'active' : 'inactive']
                      }`}
                    >
                      {t(
                        item.isActive
                          ? 'analyzers.active'
                          : 'analyzers.inactive'
                      )}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="flex w-24 items-center justify-end gap-1">
                      <IconActionButton
                        icon={Pencil}
                        label={t('analyzers.edit')}
                        onClick={() => setEditingItem(item)}
                        variant="neutral"
                      />
                      <IconActionButton
                        icon={Power}
                        label={t(
                          item.isActive
                            ? 'analyzers.confirm_disable'
                            : 'analyzers.confirm_enable'
                        )}
                        onClick={() => handleToggleActive(item)}
                        variant={item.isActive ? 'danger' : 'neutral'}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreateModal && (
        <AnalyzerModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          analyzer={null}
        />
      )}

      {editingItem && (
        <AnalyzerModal
          open={!!editingItem}
          onClose={() => setEditingItem(null)}
          analyzer={editingItem}
        />
      )}
    </div>
  );
}
