import { useState, FormEvent, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Copy,
  Pencil,
  Upload,
  Archive,
  Plus,
  Trash2,
} from 'lucide-react';
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
  Species,
} from '../../types/lab.types';

const SPECIES_OPTIONS: (Species | 'ANY')[] = [
  'ANY',
  'DOG',
  'CAT',
  'EQUINE',
  'BOVINE',
  'BIRD',
  'REPTILE',
  'RABBIT',
  'OTHER',
];

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
  const [showNewModal, setShowNewModal] = useState(false);
  const [newForm, setNewForm] = useState({
    title: '',
    catalogItemCode: '',
    catalogItemId: '',
    species: 'ANY' as Species | 'ANY',
  });
  const [newSubmitting, setNewSubmitting] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [catalogItems, setCatalogItems] = useState<
    { id: string; name: string; code: string }[]
  >([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!catalogOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!comboboxRef.current?.contains(e.target as Node))
        setCatalogOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [catalogOpen]);

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

  const handleDelete = async (def: TemplateDefinition) => {
    const ver = def.activeVersion ?? def.versions?.[0] ?? null;
    try {
      const confirmed = await confirm({
        title: t('templates.confirm_delete'),
        message: t('templates.confirm_delete_message', {
          title: ver?.title ?? def.catalogItemCode,
        }),
        confirmLabel: t('templates.delete'),
        variant: 'destructive',
        icon: Trash2,
        onConfirm: () => labApi.templates.delete(def.id),
      });
      if (!confirmed) return;
      toast.success(t('templates.deleted_success'));
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

  const handleCreateNew = async (e: FormEvent) => {
    e.preventDefault();
    setNewSubmitting(true);
    setNewError(null);
    try {
      const def = await labApi.templates.create({
        title: newForm.title.trim(),
        catalogItemCode: newForm.catalogItemCode.trim().toUpperCase(),
        species: newForm.species,
        sections: [],
      });
      invalidate();
      setShowNewModal(false);
      setNewForm({
        title: '',
        catalogItemCode: '',
        catalogItemId: '',
        species: 'ANY',
      });
      setCatalogSearch('');
      setCatalogOpen(false);
      // Navigate to builder with the newly created draft version
      const versionId =
        (
          def as unknown as {
            activeVersion?: { id: string };
            versions?: { id: string }[];
          }
        ).activeVersion?.id ??
        (def as unknown as { versions?: { id: string }[] }).versions?.[0]?.id;
      if (versionId)
        navigate(`/templates/${def.id}/versions/${versionId}/edit`);
    } catch (err) {
      setNewError((err as Error).message);
    } finally {
      setNewSubmitting(false);
    }
  };

  const renderRow = (def: TemplateDefinition) => {
    // activeVersion = the published version. For draft-only templates it's null,
    // so fall back to the latest draft returned in the versions array.
    const ver = def.activeVersion ?? def.versions?.[0] ?? null;
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
          <div className="flex shrink-0 items-center gap-2">
            {!isLab && (
              <button
                onClick={() => handleCustomize(def)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
              >
                <Copy size={13} />
                {t('templates.customize')}
              </button>
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
            {isLab && (
              <IconActionButton
                icon={Trash2}
                label={t('templates.delete')}
                onClick={() => handleDelete(def)}
                variant="danger"
              />
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
        {isAdmin && (
          <button
            onClick={() => {
              setShowNewModal(true);
              setLoadingCatalog(true);
              labApi.catalog
                .listActive()
                .then((res) =>
                  setCatalogItems(
                    res.data
                      .filter((i) => i.kind === 'TEST' && i.active)
                      .map((i) => ({
                        id: i.id,
                        name: i.name,
                        code: i.code ?? '',
                      }))
                  )
                )
                .finally(() => setLoadingCatalog(false));
            }}
            className="flex items-center gap-2 rounded-xl bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            <Plus size={16} />
            {t('templates.new_template')}
          </button>
        )}
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

      {/* New template modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <h2 className="text-base font-semibold text-white">
                {t('templates.new_template')}
              </h2>
              <button
                onClick={() => {
                  setShowNewModal(false);
                  setNewForm({
                    title: '',
                    catalogItemCode: '',
                    catalogItemId: '',
                    species: 'ANY',
                  });
                }}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateNew} className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('templates.form_title')} *
                </label>
                <input
                  required
                  type="text"
                  value={newForm.title}
                  onChange={(e) =>
                    setNewForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder={t('templates.form_title_placeholder')}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('test_config.test_name')} *
                </label>
                <div ref={comboboxRef} className="relative">
                  <input
                    required={!newForm.catalogItemId}
                    readOnly={!!newForm.catalogItemId}
                    value={
                      newForm.catalogItemId
                        ? `${
                            catalogItems.find(
                              (i) => i.id === newForm.catalogItemId
                            )?.name ?? ''
                          } (${newForm.catalogItemCode})`
                        : catalogSearch
                    }
                    onChange={(e) => {
                      setCatalogSearch(e.target.value);
                      setCatalogOpen(true);
                    }}
                    onFocus={() => {
                      if (!newForm.catalogItemId) setCatalogOpen(true);
                    }}
                    onClick={() => {
                      if (newForm.catalogItemId) {
                        setNewForm((f) => ({
                          ...f,
                          catalogItemId: '',
                          catalogItemCode: '',
                        }));
                        setCatalogSearch('');
                        setCatalogOpen(true);
                      }
                    }}
                    placeholder={t('test_config.select_test')}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
                  />
                  {catalogOpen && (
                    <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
                      {loadingCatalog && (
                        <p className="px-3 py-2 text-xs text-gray-400">
                          {t('common.loading')}
                        </p>
                      )}
                      {!loadingCatalog &&
                        (() => {
                          const q = catalogSearch.toLowerCase();
                          const matches = catalogItems.filter(
                            (i) =>
                              i.name.toLowerCase().includes(q) ||
                              i.code.toLowerCase().includes(q)
                          );
                          if (!matches.length)
                            return (
                              <p className="px-3 py-2 text-xs text-gray-400">
                                {t('test_config.no_results')}
                              </p>
                            );
                          return matches.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onMouseDown={() => {
                                setNewForm((f) => ({
                                  ...f,
                                  catalogItemId: item.id,
                                  catalogItemCode: item.code,
                                  title: f.title || item.name,
                                }));
                                setCatalogSearch('');
                                setCatalogOpen(false);
                              }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
                            >
                              <span>{item.name}</span>
                              <span className="font-mono text-xs text-gray-400">
                                {item.code}
                              </span>
                            </button>
                          ));
                        })()}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('templates.species_label')} *
                </label>
                <select
                  required
                  value={newForm.species}
                  onChange={(e) =>
                    setNewForm((f) => ({
                      ...f,
                      species: e.target.value as Species | 'ANY',
                    }))
                  }
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                >
                  {SPECIES_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {t(`species.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              {newError && (
                <p className="rounded-lg bg-red-950 px-3 py-2 text-xs text-red-300">
                  {newError}
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={newSubmitting}
                  className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                >
                  {newSubmitting ? '...' : t('templates.create_and_edit')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewModal(false);
                    setNewForm({
                      title: '',
                      catalogItemCode: '',
                      catalogItemId: '',
                      species: 'ANY',
                    });
                  }}
                  className="rounded-lg border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:bg-gray-800"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
