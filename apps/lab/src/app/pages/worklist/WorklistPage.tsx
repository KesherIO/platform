import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { labApi } from '../../shared/api/labApi';
import { SearchInput } from '../../shared/components/SearchInput';
import { Pagination } from '../../shared/components/Pagination';
import { useToast } from '../../shared/components/ToastProvider';
import { useAuth } from '../../auth/AuthContext';
import { WorklistCard } from './WorklistCard';
import { ReassignModal } from './ReassignModal';
import type { WorklistItem } from '../../types/lab.types';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950';
const TOOLBAR_TAB = `flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition ${FOCUS_RING}`;
const TOOLBAR_TAB_ACTIVE = 'border-cyan/30 bg-cyan/10 text-cyan';
const TOOLBAR_TAB_INACTIVE =
  'border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white';

const PAGE_SIZE = 20;
const POLL_MS = 30_000;

const STATUS_FILTERS = [
  { key: 'READY,IN_PROGRESS', label: 'all_statuses' },
  { key: 'READY', label: 'ready' },
  { key: 'IN_PROGRESS', label: 'in_progress' },
] as const;

const ASSIGNMENT_FILTERS = [
  { key: 'all', label: 'all' },
  { key: 'unassigned', label: 'unassigned' },
  { key: 'mine', label: 'mine' },
] as const;

export function WorklistPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const department = searchParams.get('department') ?? '';
  const [statusFilter, setStatusFilter] = useState('READY,IN_PROGRESS');
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [busyTestId, setBusyTestId] = useState<string | null>(null);
  const [reassigningItem, setReassigningItem] = useState<WorklistItem | null>(
    null
  );

  const currentUserId = user?.id ?? '';

  async function refetchWorklist() {
    await queryClient.cancelQueries({ queryKey: ['worklist'] });
    await queryClient.cancelQueries({ queryKey: ['worklist-counts'] });
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['worklist'] }),
      queryClient.refetchQueries({ queryKey: ['worklist-counts'] }),
    ]);
    queryClient.invalidateQueries({ queryKey: ['worklist-ready-count'] });
  }

  // Main worklist query
  const {
    data,
    isLoading: loading,
    isFetching: fetching,
  } = useQuery({
    queryKey: [
      'worklist',
      { department, status: statusFilter, assignmentFilter, search, page },
    ],
    queryFn: () =>
      labApi.worklist.list({
        department: department || undefined,
        status: statusFilter,
        assignmentFilter: assignmentFilter as 'all' | 'unassigned' | 'mine',
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    refetchInterval: POLL_MS,
  });

  // Badge counts query
  const { data: countsData } = useQuery({
    queryKey: ['worklist-counts'],
    queryFn: () => labApi.worklist.counts(),
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (countsData) {
      queryClient.setQueryData(['worklist-ready-count'], {
        count: countsData.totalReady,
      });
    }
  }, [countsData, queryClient]);

  const items = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const departments = countsData?.departments ?? [];
  const noDept = countsData?.noDepartment;
  const allTotal =
    departments.reduce((sum, d) => sum + d.total, 0) + (noDept?.total ?? 0);

  function setDepartment(dept: string) {
    const next = new URLSearchParams(searchParams);
    if (dept) {
      next.set('department', dept);
    } else {
      next.delete('department');
    }
    setSearchParams(next, { replace: true });
    setPage(1);
  }

  async function handleClaim(testId: string, version: number) {
    setBusyTestId(testId);
    try {
      await labApi.worklist.claim(testId, version);
      toast.success(t('worklist.success.claimed'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (
        msg.includes('409') ||
        msg.includes('modified') ||
        msg.includes('claimed')
      ) {
        toast.error(t('worklist.errors.conflict'));
      } else {
        toast.error(t('worklist.errors.claim'));
      }
    }
    await refetchWorklist();
    setBusyTestId(null);
  }

  async function handleUnclaim(testId: string) {
    setBusyTestId(testId);
    try {
      await labApi.worklist.unclaim(testId);
      toast.success(t('worklist.success.unclaimed'));
    } catch {
      toast.error(t('worklist.errors.unclaim'));
    }
    await refetchWorklist();
    setBusyTestId(null);
  }

  async function handleStart(testId: string) {
    setBusyTestId(testId);
    try {
      await labApi.worklist.start(testId);
      toast.success(t('worklist.success.started'));
    } catch {
      toast.error(t('worklist.errors.start'));
    }
    await refetchWorklist();
    setBusyTestId(null);
  }

  function handleReassignClick(testId: string) {
    const item = items.find((i) => i.id === testId);
    if (item) setReassigningItem(item);
  }

  async function handleReassigned() {
    setReassigningItem(null);
    toast.success(t('worklist.success.reassigned'));
    await refetchWorklist();
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {t('worklist.title')}
          </h1>
          <p className="text-sm text-gray-400">
            {total} {t('worklist.subtitle')}
          </p>
        </div>
      </div>

      {/* Department tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setDepartment('')}
          className={`${TOOLBAR_TAB} ${
            !department ? TOOLBAR_TAB_ACTIVE : TOOLBAR_TAB_INACTIVE
          }`}
        >
          {t('worklist.tab_all')}
          {countsData && (
            <span className="ml-1.5 text-xs opacity-70">{allTotal}</span>
          )}
        </button>
        {departments
          .filter((d) => d.total > 0)
          .map((d) => (
            <button
              key={d.department}
              onClick={() => setDepartment(d.department)}
              className={`${TOOLBAR_TAB} ${
                department === d.department
                  ? TOOLBAR_TAB_ACTIVE
                  : TOOLBAR_TAB_INACTIVE
              }`}
            >
              {t(`worklist.department.${d.department}`)}
              {d.ready > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan/20 px-1 text-xs font-semibold text-cyan">
                  {d.ready}
                </span>
              )}
            </button>
          ))}
        {noDept && noDept.total > 0 && (
          <button
            onClick={() => setDepartment('__none__')}
            className={`${TOOLBAR_TAB} ${
              department === '__none__'
                ? TOOLBAR_TAB_ACTIVE
                : TOOLBAR_TAB_INACTIVE
            }`}
          >
            {t('worklist.tab_no_department')}
            {noDept.ready > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan/20 px-1 text-xs font-semibold text-cyan">
                {noDept.ready}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status filter */}
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setStatusFilter(f.key);
              setPage(1);
            }}
            className={`${TOOLBAR_TAB} ${
              statusFilter === f.key ? TOOLBAR_TAB_ACTIVE : TOOLBAR_TAB_INACTIVE
            }`}
          >
            {t(`worklist.filter.${f.label}`)}
          </button>
        ))}

        <div className="mx-1 h-6 w-px bg-gray-800" />

        {/* Assignment filter */}
        {ASSIGNMENT_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setAssignmentFilter(f.key);
              setPage(1);
            }}
            className={`${TOOLBAR_TAB} ${
              assignmentFilter === f.key
                ? TOOLBAR_TAB_ACTIVE
                : TOOLBAR_TAB_INACTIVE
            }`}
          >
            {t(`worklist.assignment.${f.label}`)}
          </button>
        ))}

        <div className="ml-auto w-64">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={t('worklist.search_placeholder')}
          />
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && items.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg bg-gray-800/50"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && data === undefined && (
        <p className="py-8 text-center text-sm text-red-400">
          {t('worklist.error')}
        </p>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && data !== undefined && (
        <p className="py-8 text-center text-sm text-gray-400">
          {t('worklist.empty')}
        </p>
      )}

      {/* Item list */}
      {items.length > 0 && (
        <div
          className={`space-y-2 transition-opacity ${
            fetching && !loading ? 'opacity-60' : ''
          }`}
        >
          {items.map((item) => (
            <WorklistCard
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onClaim={handleClaim}
              onUnclaim={handleUnclaim}
              onStart={handleStart}
              onReassign={handleReassignClick}
              busy={busyTestId === item.id}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}

      {/* Reassign modal */}
      {reassigningItem && (
        <ReassignModal
          testId={reassigningItem.id}
          currentAssigneeId={reassigningItem.assignedUserId}
          version={reassigningItem.version}
          onClose={() => setReassigningItem(null)}
          onReassigned={handleReassigned}
        />
      )}
    </div>
  );
}
