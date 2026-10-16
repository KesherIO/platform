import { useEffect, useState, useRef, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, MoreVertical, History, UserCog } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi, apiErrorMessage } from '../../shared/api/labApi';
import {
  WeeklyScheduleEditor,
  makeEmptySchedule,
} from '../../shared/components/WeeklyScheduleEditor';
import type {
  LabMember,
  LabRole,
  RemovedLabMember,
  WeeklySchedule,
} from '../../types/lab.types';
import { ReasonDialog } from './ReasonDialog';
import { MembershipHistoryPanel } from './MembershipHistoryPanel';

/**
 * Roles an admin can assign (the API rejects OWNER; no ownership transfer
 * yet). Same as LAB_ASSIGNABLE_ROLES in the API.
 */
const ROLES: LabRole[] = [
  'ADMIN',
  'REVIEWER',
  'ANALYST',
  'RESULTS_VIEWER',
  'MESSENGER',
];

/** Pickups are intrinsic to MESSENGER and never for a results viewer. */
const canHavePickups = (role: LabRole) =>
  role !== 'MESSENGER' && role !== 'RESULTS_VIEWER';

const ROLE_COLORS: Record<LabRole, string> = {
  OWNER: 'bg-amber-400/20 text-amber-300',
  ADMIN: 'bg-purple/20 text-purple',
  REVIEWER: 'bg-emerald-400/20 text-emerald-300',
  ANALYST: 'bg-cyan/20 text-cyan',
  RESULTS_VIEWER: 'bg-blue-400/20 text-blue-300',
  MESSENGER: 'bg-orange-900/30 text-orange-300',
  // Retired lab roles, only in old history entries
  TECHNICIAN: 'bg-gray-700 text-gray-300',
  DATA_ENTRY: 'bg-gray-700 text-gray-300',
};

interface CreateForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: LabRole;
  schedule: WeeklySchedule;
  canPerformPickups: boolean;
  canViewInProgress: boolean;
}

interface EditForm {
  firstName: string;
  lastName: string;
  email: string;
  role: LabRole;
  schedule: WeeklySchedule;
  canPerformPickups: boolean;
  canViewInProgress: boolean;
  /** Audit-log reason: required for a role change, optional for the flags. */
  reason: string;
}

const EMPTY_FORM: CreateForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'ANALYST',
  schedule: makeEmptySchedule(),
  canPerformPickups: false,
  canViewInProgress: false,
};

function RowActionsMenu({
  onEdit,
  onHistory,
  onRemove,
  disableEdit,
  disableRemove,
  editLabel,
  historyLabel,
  removeLabel,
}: {
  onEdit: () => void;
  onHistory: () => void;
  onRemove: () => void;
  disableEdit: boolean;
  disableRemove: boolean;
  editLabel: string;
  historyLabel: string;
  removeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-white"
        aria-label="Actions"
      >
        <MoreVertical size={18} strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-lg">
          <button
            type="button"
            onClick={() => {
              if (!disableEdit) {
                onEdit();
                setOpen(false);
              }
            }}
            disabled={disableEdit}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition ${
              disableEdit
                ? 'cursor-not-allowed text-gray-600'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Pencil size={15} strokeWidth={2} />
            {editLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onHistory();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-t border-gray-800 px-3 py-2.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
          >
            <History size={15} strokeWidth={2} />
            {historyLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!disableRemove) {
                onRemove();
                setOpen(false);
              }
            }}
            disabled={disableRemove}
            className={`flex w-full items-center gap-2 border-t border-gray-800 px-3 py-2.5 text-sm transition ${
              disableRemove
                ? 'cursor-not-allowed text-gray-600'
                : 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
            }`}
          >
            <Trash2 size={15} strokeWidth={2} />
            {removeLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function TeamPage() {
  const { t, i18n } = useTranslation();
  const { user, isAdmin, labRole, refreshTenant } = useAuth();
  // Only an owner may change or remove an owner (the API enforces it too,
  // plus "at least one owner"). Changing an owner's role isn't offered here.
  const canManage = (member: LabMember) =>
    isAdmin &&
    member.userId !== user?.id &&
    (member.role !== 'OWNER' || labRole === 'OWNER');
  // Editing details (yourself included) has the same owner rule.
  const canEdit = (member: LabMember) =>
    isAdmin && (member.role !== 'OWNER' || labRole === 'OWNER');
  const queryClient = useQueryClient();

  const {
    data: members = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['users'],
    queryFn: () => labApi.users.list() as Promise<LabMember[]>,
  });

  const error = queryError ? t('team.errors.load') : null;

  // Removed people drop out of the team list; this keeps their history reachable.
  const { data: removedMembers = [] } = useQuery({
    queryKey: ['users-removed'],
    queryFn: () => labApi.users.removed() as Promise<RemovedLabMember[]>,
    enabled: isAdmin,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    firstName: '',
    lastName: '',
    email: '',
    role: 'ANALYST',
    schedule: makeEmptySchedule(),
    canPerformPickups: false,
    canViewInProgress: false,
    reason: '',
  });
  const [editOriginal, setEditOriginal] = useState<LabMember | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pendingRoleChange, setPendingRoleChange] = useState<{
    member: LabMember;
    role: LabRole;
  } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<LabMember | null>(null);
  const [historyFor, setHistoryFor] = useState<{
    userId?: string;
    title: string;
  } | null>(null);

  const nameOf = (member: LabMember) =>
    [member.firstName, member.lastName].filter(Boolean).join(' ') ||
    member.email;

  const invalidateUsers = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['users-removed'] });
    queryClient.invalidateQueries({ queryKey: ['membership-history'] });
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const { schedule, canPerformPickups, canViewInProgress, ...rest } = form;
      const payload =
        form.role === 'MESSENGER'
          ? { ...rest, schedule }
          : form.role === 'RESULTS_VIEWER'
          ? { ...rest, ...(canViewInProgress && { canViewInProgress: true }) }
          : { ...rest, ...(canPerformPickups && { canPerformPickups: true }) };
      await labApi.users.create(payload as unknown as Record<string, unknown>);
      setShowForm(false);
      setForm(EMPTY_FORM);
      invalidateUsers();
    } catch (err) {
      setFormError(`${t('team.errors.create')} ${apiErrorMessage(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Role and removal changes ask for a reason first (audit log).
  const handleRoleChange = (member: LabMember, role: LabRole) => {
    if (role !== member.role) setPendingRoleChange({ member, role });
  };

  const handleRemove = (member: LabMember) => setPendingRemoval(member);

  const startEditing = (member: LabMember) => {
    setEditForm({
      firstName: member.firstName ?? '',
      lastName: member.lastName ?? '',
      email: member.email,
      role: member.role,
      schedule: member.schedule ?? makeEmptySchedule(),
      canPerformPickups: member.canPerformPickups,
      canViewInProgress: member.canViewInProgress,
      reason: '',
    });
    setEditOriginal(member);
    setEditingId(member.userId);
    setActionError(null);
  };

  const editRoleChanged = !!editOriginal && editForm.role !== editOriginal.role;
  const editPickupsChanged =
    !!editOriginal &&
    canHavePickups(editForm.role) &&
    editForm.canPerformPickups !== editOriginal.canPerformPickups;
  const editInProgressChanged =
    !!editOriginal &&
    editForm.role === 'RESULTS_VIEWER' &&
    editForm.canViewInProgress !== editOriginal.canViewInProgress;
  const editReasonMissing = editRoleChanged && !editForm.reason.trim();

  const handleSaveEdit = async (originalRole: LabRole) => {
    if (!editingId || editReasonMissing) return;
    try {
      setSaving(true);
      setActionError(null);
      const {
        schedule,
        canPerformPickups,
        canViewInProgress,
        role,
        reason,
        ...rest
      } = editForm;
      const trimmedReason = reason.trim();
      const payload =
        role === 'MESSENGER'
          ? { ...rest, schedule }
          : {
              ...rest,
              ...(role === 'RESULTS_VIEWER'
                ? { canViewInProgress }
                : { canPerformPickups }),
              ...(trimmedReason && { reason: trimmedReason }),
            };
      // Role first: the flags only apply to the new role (e.g. in-progress
      // access exists only for a results viewer).
      if (role !== originalRole) {
        await labApi.users.updateRole(editingId, role, trimmedReason);
      }
      await labApi.users.update(
        editingId,
        payload as unknown as Record<string, unknown>
      );
      if (editingId === user?.id) await refreshTenant();
      setEditingId(null);
      setEditOriginal(null);
      invalidateUsers();
    } catch (err) {
      setActionError(`${t('team.errors.update')} ${apiErrorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{t('team.title')}</h1>
          {!loading && (
            <p className="mt-0.5 text-sm text-gray-400">
              {members.length} {t('team.members')}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHistoryFor({ title: t('team.history.title') })}
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              <History size={15} strokeWidth={2} />
              {t('team.history.open')}
            </button>
            <button
              onClick={() => {
                setShowForm(true);
                setFormError(null);
              }}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
            >
              + {t('team.add_user')}
            </button>
          </div>
        )}
      </div>

      {/* Add user form */}
      {showForm && (
        <div className="mb-6 rounded-xl border border-gray-700 bg-gray-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">
            {t('team.form.title')}
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('team.form.first_name')}
                </label>
                <input
                  required
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('team.form.last_name')}
                </label>
                <input
                  required
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('team.form.email')}
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('team.form.password')}
              </label>
              <input
                type="password"
                required
                minLength={10}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t('team.form.password_hint')}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('team.form.role')}
              </label>
              <select
                value={form.role}
                onChange={(e) => {
                  const newRole = e.target.value as LabRole;
                  setForm({
                    ...form,
                    role: newRole,
                    ...(!canHavePickups(newRole) && {
                      canPerformPickups: false,
                    }),
                    ...(newRole !== 'RESULTS_VIEWER' && {
                      canViewInProgress: false,
                    }),
                  });
                }}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`team.roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>

            {form.role === 'MESSENGER' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('team.schedule.title')}
                </label>
                <WeeklyScheduleEditor
                  value={form.schedule}
                  onChange={(schedule) => setForm({ ...form, schedule })}
                />
              </div>
            )}

            {canHavePickups(form.role) && (
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.canPerformPickups}
                  onChange={(e) =>
                    setForm({ ...form, canPerformPickups: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan accent-cyan"
                />
                {t('team.form.can_perform_pickups')}
              </label>
            )}

            {form.role === 'RESULTS_VIEWER' && (
              <label className="flex items-start gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.canViewInProgress}
                  onChange={(e) =>
                    setForm({ ...form, canViewInProgress: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan accent-cyan"
                />
                <span>
                  {t('team.form.can_view_in_progress')}
                  <span className="block text-xs text-gray-500">
                    {t('team.form.can_view_in_progress_hint')}
                  </span>
                </span>
              </label>
            )}

            {formError && (
              <p className="rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
                {formError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-cyan px-5 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? t('team.form.submitting') : t('team.form.submit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                }}
                className="rounded-lg border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('team.form.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {actionError && (
        <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {/* Members list — skeleton */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <div className="h-9 w-9 animate-pulse rounded-full bg-gray-700" />
                <div className="space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-gray-700" />
                  <div className="h-3 w-44 animate-pulse rounded bg-gray-800" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-6 w-20 animate-pulse rounded-full bg-gray-700" />
                <div className="h-7 w-16 animate-pulse rounded-lg bg-gray-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && members.length === 0 && (
        <div className="py-16 text-center text-gray-500">{t('team.empty')}</div>
      )}

      {!loading && !error && members.length > 0 && (
        <div className="space-y-2">
          {members.map((member) => {
            const isMe = member.userId === user?.id;
            const isEditing = editingId === member.userId;
            const displayName =
              [member.firstName, member.lastName].filter(Boolean).join(' ') ||
              member.email;

            return (
              <div
                key={member.userId}
                className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">
                          {t('team.form.first_name')}
                        </label>
                        <input
                          value={editForm.firstName}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              firstName: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">
                          {t('team.form.last_name')}
                        </label>
                        <input
                          value={editForm.lastName}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              lastName: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">
                        {t('team.form.email')}
                      </label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, email: e.target.value }))
                        }
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">
                        {t('team.form.role')}
                      </label>
                      {member.role === 'OWNER' ? (
                        <span
                          className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${ROLE_COLORS.OWNER}`}
                        >
                          {t('team.roles.OWNER')}
                        </span>
                      ) : (
                        <select
                          value={editForm.role}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              role: e.target.value as LabRole,
                            }))
                          }
                          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`team.roles.${r}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {editForm.role === 'MESSENGER' && (
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">
                          {t('team.schedule.title')}
                        </label>
                        <WeeklyScheduleEditor
                          value={editForm.schedule}
                          onChange={(schedule) =>
                            setEditForm((f) => ({ ...f, schedule }))
                          }
                        />
                      </div>
                    )}
                    {canHavePickups(editForm.role) && (
                      <label className="flex items-center gap-2 text-sm text-gray-300">
                        <input
                          type="checkbox"
                          checked={editForm.canPerformPickups}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              canPerformPickups: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan accent-cyan"
                        />
                        {t('team.form.can_perform_pickups')}
                      </label>
                    )}
                    {editForm.role === 'RESULTS_VIEWER' && (
                      <label className="flex items-start gap-2 text-sm text-gray-300">
                        <input
                          type="checkbox"
                          checked={editForm.canViewInProgress}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              canViewInProgress: e.target.checked,
                            }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan accent-cyan"
                        />
                        <span>
                          {t('team.form.can_view_in_progress')}
                          <span className="block text-xs text-gray-500">
                            {t('team.form.can_view_in_progress_hint')}
                          </span>
                        </span>
                      </label>
                    )}
                    {(editRoleChanged ||
                      editPickupsChanged ||
                      editInProgressChanged) && (
                      <div>
                        <label className="mb-1 block text-xs text-gray-500">
                          {editRoleChanged
                            ? t('team.reason.label')
                            : t('team.reason.label_optional')}
                        </label>
                        <textarea
                          value={editForm.reason}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              reason: e.target.value,
                            }))
                          }
                          maxLength={500}
                          rows={2}
                          placeholder={t('team.reason.placeholder')}
                          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(member.role)}
                        disabled={saving || editReasonMissing}
                        className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
                      >
                        {saving ? t('team.saving') : t('team.save')}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                        className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
                      >
                        {t('team.form.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-700 text-sm font-semibold text-white">
                        {(
                          member.firstName?.[0] ?? member.email[0]
                        ).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {displayName}
                          {isMe && (
                            <span className="ml-2 text-xs text-gray-500">
                              ({t('team.you')})
                            </span>
                          )}
                          {member.signerRoles && (
                            <span
                              title={member.signerRoles
                                .map((r) =>
                                  t(`settings.role_${r.toLowerCase()}`)
                                )
                                .join(', ')}
                              className="ml-2 rounded-full bg-purple/20 px-2 py-0.5 text-xs font-medium text-purple"
                            >
                              {t('team.signer_badge')}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-gray-400">
                          {member.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {/* Status area — fixed width so rows align */}
                      <div className="flex w-28 justify-end">
                        {member.role === 'MESSENGER' && (
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              member.isCurrentlyScheduled
                                ? 'bg-emerald-900/30 text-emerald-300'
                                : 'bg-gray-800 text-gray-500'
                            }`}
                          >
                            {member.isCurrentlyScheduled
                              ? t('team.schedule.in_schedule')
                              : t('team.schedule.off_schedule')}
                          </span>
                        )}
                        {member.canPerformPickups &&
                          member.role !== 'MESSENGER' && (
                            <span className="rounded-full bg-orange-900/30 px-2.5 py-0.5 text-xs font-medium text-orange-300">
                              {t('team.can_perform_pickups_badge')}
                            </span>
                          )}
                        {member.canViewInProgress &&
                          member.role === 'RESULTS_VIEWER' && (
                            <span className="rounded-full bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-300">
                              {t('team.can_view_in_progress_badge')}
                            </span>
                          )}
                      </div>

                      {/* Role — fixed width */}
                      <div className="flex w-32 justify-end">
                        {!canManage(member) || member.role === 'OWNER' ? (
                          <span
                            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                              ROLE_COLORS[member.role]
                            }`}
                          >
                            {t(`team.roles.${member.role}`)}
                          </span>
                        ) : (
                          <select
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(
                                member,
                                e.target.value as LabRole
                              )
                            }
                            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-white focus:border-cyan focus:outline-none"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {t(`team.roles.${r}`)}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Actions menu */}
                      {isAdmin && (
                        <RowActionsMenu
                          onEdit={() => startEditing(member)}
                          onHistory={() =>
                            setHistoryFor({
                              userId: member.userId,
                              title: t('team.history.title_for', {
                                name: displayName,
                              }),
                            })
                          }
                          onRemove={() => handleRemove(member)}
                          disableEdit={!canEdit(member)}
                          disableRemove={!canManage(member)}
                          editLabel={t('team.actions.edit')}
                          historyLabel={t('team.actions.history')}
                          removeLabel={t('team.actions.remove')}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Former members — history stays available after removal */}
      {isAdmin && removedMembers.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-400">
            {t('team.removed.title')} ({removedMembers.length})
          </h2>
          <div className="space-y-2">
            {removedMembers.map((r) => {
              const name = r.name ?? r.email ?? r.userId;
              return (
                <div
                  key={r.userId}
                  className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-300">{name}</p>
                    <p className="truncate text-xs text-gray-500">
                      {t('team.removed.removed_on', {
                        date: new Date(r.removedAt).toLocaleDateString(
                          i18n.language
                        ),
                      })}
                      {r.lastRole && ` · ${t(`team.roles.${r.lastRole}`)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setHistoryFor({
                        userId: r.userId,
                        title: t('team.history.title_for', { name }),
                      })
                    }
                    className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                  >
                    <History size={14} strokeWidth={2} />
                    {t('team.actions.history')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingRoleChange && (
        <ReasonDialog
          title={t('team.role_change.title')}
          message={t('team.role_change.confirm', {
            name: nameOf(pendingRoleChange.member),
            from: t(`team.roles.${pendingRoleChange.member.role}`),
            to: t(`team.roles.${pendingRoleChange.role}`),
          })}
          confirmLabel={t('team.role_change.submit')}
          required
          icon={UserCog}
          onCancel={() => setPendingRoleChange(null)}
          onSubmit={async (reason) => {
            await labApi.users.updateRole(
              pendingRoleChange.member.userId,
              pendingRoleChange.role,
              reason
            );
            setPendingRoleChange(null);
            invalidateUsers();
          }}
        />
      )}

      {pendingRemoval && (
        <ReasonDialog
          title={t('team.remove.title')}
          message={t('team.remove.confirm', { name: nameOf(pendingRemoval) })}
          confirmLabel={t('team.actions.remove')}
          required
          destructive
          icon={Trash2}
          onCancel={() => setPendingRemoval(null)}
          onSubmit={async (reason) => {
            await labApi.users.remove(pendingRemoval.userId, reason);
            setPendingRemoval(null);
            invalidateUsers();
          }}
        />
      )}

      {historyFor && (
        <MembershipHistoryPanel
          userId={historyFor.userId}
          title={historyFor.title}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}
