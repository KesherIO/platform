import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Copy, Pencil, Upload, Archive, Plus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { IconActionButton } from '../../shared/components/IconActionButton';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import type {
  TemplateDefinition,
  TemplateScope,
  TemplateStatus,
} from '../../types/lab.types';

const STATUS_COLORS: Record<TemplateStatus, string> = {
  DRAFT: 'bg-yellow-900/30 text-yellow-300',
  PUBLISHED: 'bg-green-900/30 text-green-300',
  ARCHIVED: 'bg-gray-800 text-gray-400',
};

const SCOPE_COLORS: Record<TemplateScope, string> = {
  PLATFORM: 'bg-blue-900/30 text-blue-300',
  LABORATORY: 'bg-purple-900/30 text-purple-300',
};

function formatAge(weeks: number, t: (key: string) => string): string {
  if (weeks === -1) return t('templates.age_any');
  return String(weeks);
}

export function TemplateManagementPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['templates'],
    queryFn: () => labApi.templates.list(),
  });

  const allTemplates = data ?? [];

  const filtered = allTemplates.filter((def) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const title = def.activeVersion?.title?.toLowerCase() ?? '';
    const code = def.catalogItemCode.toLowerCase();
    return code.includes(q) || title.includes(q);
  });

  const platformTemplates = filtered.filter((d) => d.scope === 'PLATFORM');
  const labTemplates = filtered.filter((d) => d.scope === 'LABORATORY');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['templates'] });
  };

  const handleCustomize = async (def: TemplateDefinition) => {
    try {
      const confirmed = await confirm({
        title: t('templates.confirm_customize'),
        message: t('templates.confirm_customize'),
        confirmLabel: t('templates.customize'),
        variant: 'default',
        icon: Copy,
        onConfirm: () => labApi.templates.clone(def.id),
      });
      if (!confirmed) return;
      toast.success(t('templates.customized_success'));
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handlePublish = async (versionId: string) => {
    try {
      const confirmed = await confirm({
        title: t('templates.confirm_publish'),
        message: t('templates.confirm_publish'),
        confirmLabel: t('templates.publish'),
        variant: 'default',
        icon: Upload,
        onConfirm: () => labApi.templates.publish(versionId),
      });
      if (!confirmed) return;
      toast.success(t('templates.published_success'));
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleArchive = async (versionId: string) => {
    try {
      const confirmed = await confirm({
        title: t('templates.confirm_archive'),
        message: t('templates.confirm_archive'),
        confirmLabel: t('templates.archive'),
        variant: 'destructive',
        icon: Archive,
        onConfirm: () => labApi.templates.archive(versionId),
      });
      if (!confirmed) return;
      toast.success(t('templates.archived_success'));
      invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleNewDraft = async (def: TemplateDefinition) => {
    try {
      const version = await labApi.templates.createDraft(def.id);
      invalidate();
      navigate(`/templates/${def.id}/versions/${version.id}/edit`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const renderRow = (def: TemplateDefinition) => {
    const ver = def.activeVersion;
    const status = ver?.status ?? 'DRAFT';
    const isLab = def.scope === 'LABORATORY';

    return (
      <div
        key={def.id}
        className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <FileText size={16} className="shrink-0 text-gray-500" />
            <span className="truncate">
              {ver?.title ?? def.catalogItemCode}
            </span>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status]}`}
            >
              {t(`templates.status.${status}`)}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {def.catalogItemCode}
            {' · '}
            {t(`species.${def.species}`)}
            {' · '}
            {t('templates.version_label')} {ver?.version ?? '—'}
            {' · '}
            {t('templates.age_min')}: {formatAge(def.ageMinWeeks, t)}
            {' — '}
            {t('templates.age_max')}: {formatAge(def.ageMaxWeeks, t)}
          </p>
        </div>

        {isAdmin && (
          <div className="flex shrink-0 items-center gap-1">
            {!isLab && (
              <IconActionButton
                icon={Copy}
                label={t('templates.customize')}
                onClick={() => handleCustomize(def)}
                variant="neutral"
              />
            )}
            {isLab && status === 'DRAFT' && ver && (
              <>
                <IconActionButton
                  icon={Pencil}
                  label={t('templates.edit')}
                  onClick={() =>
                    navigate(`/templates/${def.id}/versions/${ver.id}/edit`)
                  }
                  variant="neutral"
                />
                <IconActionButton
                  icon={Upload}
                  label={t('templates.publish')}
                  onClick={() => handlePublish(ver.id)}
                  variant="neutral"
                />
              </>
            )}
            {isLab && status === 'PUBLISHED' && ver && (
              <>
                <IconActionButton
                  icon={Plus}
                  label={t('templates.new_draft')}
                  onClick={() => handleNewDraft(def)}
                  variant="neutral"
                />
                <IconActionButton
                  icon={Archive}
                  label={t('templates.archive')}
                  onClick={() => handleArchive(ver.id)}
                  variant="danger"
                />
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (
    titleKey: string,
    scopeBadgeKey: string,
    scope: TemplateScope,
    items: TemplateDefinition[]
  ) => (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-white">{t(titleKey)}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SCOPE_COLORS[scope]}`}
        >
          {t(scopeBadgeKey)}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          {t('templates.no_results')}
        </div>
      ) : (
        <div className="space-y-2">{items.map(renderRow)}</div>
      )}
    </div>
  );

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {t('templates.title')}
          </h1>
          {!isLoading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {allTemplates.length} {t('templates.title').toLowerCase()}
            </p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('templates.search_placeholder')}
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
          {t('common.error_loading')}
        </div>
      )}

      {!isLoading && !error && (
        <div
          className={`transition-opacity ${
            isFetching ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {renderSection(
            'templates.platform_section',
            'templates.scope.PLATFORM',
            'PLATFORM',
            platformTemplates
          )}
          {renderSection(
            'templates.lab_section',
            'templates.scope.LABORATORY',
            'LABORATORY',
            labTemplates
          )}
        </div>
      )}
    </div>
  );
}
