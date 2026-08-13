import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, Wrench } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { IconActionButton } from '../../shared/components/IconActionButton';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import { TestConfigModal } from './TestConfigModal';
import type { LabTestConfiguration, Department } from '../../types/lab.types';

const DEPARTMENT_COLORS: Record<Department, string> = {
  HEMATOLOGY: 'bg-red-900/30 text-red-300',
  CHEMISTRY: 'bg-blue-900/30 text-blue-300',
  URINALYSIS: 'bg-yellow-900/30 text-yellow-300',
  PARASITOLOGY: 'bg-green-900/30 text-green-300',
  SEROLOGY: 'bg-purple-900/30 text-purple-300',
  ENDOCRINOLOGY: 'bg-orange-900/30 text-orange-300',
  MICROBIOLOGY: 'bg-teal-900/30 text-teal-300',
  OTHER: 'bg-gray-800/50 text-gray-300',
};

export function TestConfigPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LabTestConfiguration | null>(null);

  const { data: configs = [], isLoading, isFetching, error } = useQuery({
    queryKey: ['testConfigs'],
    queryFn: () => labApi.testConfigs.list(),
  });

  const { data: analyzers = [] } = useQuery({
    queryKey: ['analyzers'],
    queryFn: () => labApi.analyzers.list(),
  });

  const filtered = useMemo(() => {
    if (!search) return configs;
    const q = search.toLowerCase();
    return configs.filter(
      (c) =>
        c.catalogItem.name.toLowerCase().includes(q) ||
        (c.catalogItem.code && c.catalogItem.code.toLowerCase().includes(q))
    );
  }, [configs, search]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['testConfigs'] });
  };

  const handleDelete = async (config: LabTestConfiguration) => {
    try {
      const confirmed = await confirm({
        title: t('test_config.confirm_delete'),
        message: t('test_config.confirm_delete'),
        confirmLabel: t('common.confirm'),
        variant: 'destructive',
        icon: Trash2,
        onConfirm: () => labApi.testConfigs.remove(config.id),
      });
      if (!confirmed) return;
      toast.success(t('test_config.deleted'));
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    invalidate();
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Wrench size={20} className="text-cyan" />
            <h1 className="text-xl font-bold text-white">
              {t('test_config.title')}
            </h1>
          </div>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {filtered.length} {t('test_config.title').toLowerCase()}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            + {t('test_config.add')}
          </button>
        )}
      </div>

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('test_config.search_placeholder')}
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
          {t('test_config.no_results')}
        </div>
      )}

      {!error && filtered.length > 0 && (
        <div
          className={`transition-opacity ${
            isFetching ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {/* Table header */}
          <div className="mb-2 hidden items-center gap-4 px-5 text-xs font-medium uppercase tracking-wider text-gray-500 md:flex">
            <div className="min-w-0 flex-[2]">{t('test_config.test_name')}</div>
            <div className="w-24 text-center">{t('test_config.code')}</div>
            <div className="w-32 text-center">{t('test_config.department')}</div>
            <div className="w-28 text-center">{t('test_config.processing_method')}</div>
            <div className="w-40 text-center">{t('test_config.default_analyzer')}</div>
            {isAdmin && <div className="w-24" />}
          </div>

          <div className="space-y-2">
            {filtered.map((config) => (
              <div
                key={config.id}
                className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4 md:flex-row md:items-center md:gap-4"
              >
                {/* Test name */}
                <div className="min-w-0 flex-[2]">
                  <p className="truncate text-sm font-medium text-white">
                    {config.catalogItem.name}
                  </p>
                </div>

                {/* Code */}
                <div className="w-24 text-center">
                  <span className="text-xs text-gray-400">
                    {config.catalogItem.code || '—'}
                  </span>
                </div>

                {/* Department badge */}
                <div className="w-32 text-center">
                  <span
                    className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
                      DEPARTMENT_COLORS[config.department]
                    }`}
                  >
                    {t(`analyzers.department.${config.department}`)}
                  </span>
                </div>

                {/* Processing method */}
                <div className="w-28 text-center">
                  <span className="text-xs text-gray-300">
                    {t(`test_config.method.${config.defaultProcessingMethod}`)}
                  </span>
                </div>

                {/* Default analyzer */}
                <div className="w-40 text-center">
                  <span className="text-xs text-gray-400">
                    {config.defaultAnalyzer?.name || '—'}
                  </span>
                </div>

                {/* Actions */}
                {isAdmin && (
                  <div className="flex w-24 items-center justify-end gap-1">
                    <IconActionButton
                      icon={Pencil}
                      label={t('test_config.edit')}
                      onClick={() => setEditingConfig(config)}
                      variant="neutral"
                    />
                    <IconActionButton
                      icon={Trash2}
                      label={t('test_config.confirm_delete')}
                      onClick={() => handleDelete(config)}
                      variant="danger"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreateModal && (
        <TestConfigModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          config={null}
          analyzers={analyzers}
          existingConfigItemIds={configs.map((c) => c.catalogItemId)}
        />
      )}

      {editingConfig && (
        <TestConfigModal
          open={!!editingConfig}
          onClose={() => setEditingConfig(null)}
          config={editingConfig}
          analyzers={analyzers}
          existingConfigItemIds={configs
            .filter((c) => c.id !== editingConfig.id)
            .map((c) => c.catalogItemId)}
        />
      )}
    </div>
  );
}
