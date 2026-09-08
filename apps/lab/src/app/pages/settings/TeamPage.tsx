import { useEffect, useState, useRef, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2, MoreVertical } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import { useConfirm } from '../../shared/components/ConfirmDialogProvider';
import { useToast } from '../../shared/components/ToastProvider';
import {
  WeeklyScheduleEditor,
  makeEmptySchedule,
} from '../../shared/components/WeeklyScheduleEditor';
import type { LabMember, LabRole, WeeklySchedule } from '../../types/lab.types';

const ROLES: LabRole[] = [
  'OWNER',
  'ADMIN',
  'TECHNICIAN',
  'ANALYST',
  'REVIEWER',
  'DATA_ENTRY',
  'MESSENGER',
];

const ROLE_COLORS: Record<LabRole, string> = {
  OWNER: 'bg-amber-400/20 text-amber-300',
  ADMIN: 'bg-purple/20 text-purple',
  TECHNICIAN: 'bg-cyan/20 text-cyan',
  ANALYST: 'bg-blue-400/20 text-blue-300',
  REVIEWER: 'bg-emerald-400/20 text-emerald-300',
  DATA_ENTRY: 'bg-indigo-400/20 text-indigo-300',
  MESSENGER: 'bg-orange-900/30 text-orange-300',
};

interface CreateForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: LabRole;
  schedule: WeeklySchedule;
  canPerformPickups: boolean;
}

interface EditForm {
  firstName: string;
  lastName: string;
  email: string;
  role: LabRole;
  schedule: WeeklySchedule;
  canPerformPickups: boolean;
}

const EMPTY_FORM: CreateForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'TECHNICIAN',
  schedule: makeEmptySchedule(),
  canPerformPickups: false,
};

function RowActionsMenu({
  onEdit,
  onRemove,
  disableRemove,
  editLabel,
  removeLabel,
}: {
  onEdit: () => void;
  onRemove: () => void;
  disableRemove: boolean;
  editLabel: string;
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
              onEdit();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
          >
            <Pencil size={15} strokeWidth={2} />
            {editLabel}
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
  const { t } = useTranslation();
  const { user, isAdmin, refreshTenant } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
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

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    firstName: '',
    lastName: '',
    email: '',
    schedule: makeEmptySchedule(),
    canPerformPickups: false,
  });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: ['users'] });

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const { schedule, canPerformPickups, ...rest } = form;
      const payload =
        form.role === 'MESSENGER'
          ? { ...rest, schedule }
          : { ...rest, ...(canPerformPickups && { canPerformPickups: true }) };
      await labApi.users.create(payload as unknown as Record<string, unknown>);
      setShowForm(false);
      setForm(EMPTY_FORM);
      invalidateUsers();
    } catch (err) {
      setFormError(`${t('team.errors.create')} ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await labApi.users.updateRole(userId, role);
      invalidateUsers();
    } catch {
      invalidateUsers();
    }
  };

  const handleRemove = async (member: LabMember) => {
    const name =
      [member.firstName, member.lastName].filter(Boolean).join(' ') ||
      member.email;
    try {
      const confirmed = await confirm({
        title: t('team.remove.title'),
        message: t('team.remove.confirm', { name }),
        confirmLabel: t('team.actions.remove'),
        variant: 'destructive',
        icon: Trash2,
        onConfirm: () => labApi.users.remove(member.userId),
      });
      if (!confirmed) return;
      invalidateUsers();
    } catch (err) {
      toast.error(`${t('team.errors.remove')} ${(err as Error).message}`);
    }
  };

  const startEditing = (member: LabMember) => {
    setEditForm({
      firstName: member.firstName ?? '',
      lastName: member.lastName ?? '',
      email: member.email,
      role: member.role,
      schedule: member.schedule ?? makeEmptySchedule(),
      canPerformPickups: member.canPerformPickups,
    });
    setEditingId(member.userId);
    setActionError(null);
  };

  const handleSaveEdit = async (originalRole: LabRole) => {
    if (!editingId) return;
    try {
      setSaving(true);
      setActionError(null);
      const { schedule, canPerformPickups, role, ...rest } = editForm;
      const payload =
        role === 'MESSENGER'
          ? { ...rest, schedule }
          : { ...rest, canPerformPickups };
      await labApi.users.update(
        editingId,
        payload as unknown as Record<string, unknown>
      );
      if (role !== originalRole) {
        await labApi.users.updateRole(editingId, role);
      }
      if (editingId === user?.id) await refreshTenant();
      setEditingId(null);
      invalidateUsers();
    } catch (err) {
      setActionError(`${t('team.errors.update')} ${(err as Error).message}`);
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
          <button
            onClick={() => {
              setShowForm(true);
              setFormError(null);
            }}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
          >
            + {t('team.add_user')}
          </button>
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
                    ...(newRole === 'MESSENGER' && {
                      canPerformPickups: false,
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

            {form.role !== 'MESSENGER' && (
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
                    {editForm.role !== 'MESSENGER' && (
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(member.role)}
                        disabled={saving}
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
                      </div>

                      {/* Role — fixed width */}
                      <div className="flex w-32 justify-end">
                        {isMe || !isAdmin ? (
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
                              handleRoleChange(member.userId, e.target.value)
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
                          onRemove={() => handleRemove(member)}
                          disableRemove={isMe}
                          editLabel={t('team.actions.edit')}
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
    </div>
  );
}
