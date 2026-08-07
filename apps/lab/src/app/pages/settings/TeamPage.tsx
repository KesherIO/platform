import { useEffect, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import type { LabMember, LabRole } from '../../types/lab.types';

const ROLES: LabRole[] = ['ADMIN', 'TECHNICIAN'];

const ROLE_COLORS: Record<LabRole, string> = {
  ADMIN: 'bg-purple/20 text-purple',
  TECHNICIAN: 'bg-cyan/20 text-cyan',
};

interface CreateForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: LabRole;
}

interface EditForm {
  firstName: string;
  lastName: string;
  email: string;
}

const EMPTY_FORM: CreateForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'TECHNICIAN',
};

export function TeamPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();

  const [members, setMembers] = useState<LabMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    firstName: '',
    lastName: '',
    email: '',
  });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadMembers = (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    labApi.users
      .list()
      .then((data) => setMembers(data as LabMember[]))
      .catch(() => setError(t('team.errors.load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await labApi.users.create(form as unknown as Record<string, unknown>);
      setShowForm(false);
      setForm(EMPTY_FORM);
      loadMembers(false);
    } catch (err) {
      setFormError(`${t('team.errors.create')} ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await labApi.users.updateRole(userId, role);
      setMembers((prev) =>
        prev.map((m) =>
          m.userId === userId ? { ...m, role: role as LabRole } : m
        )
      );
    } catch {
      loadMembers(false);
    }
  };

  const handleRemove = async (member: LabMember) => {
    const name =
      [member.firstName, member.lastName].filter(Boolean).join(' ') ||
      member.email;
    if (!confirm(t('team.remove.confirm', { name }))) return;
    try {
      await labApi.users.remove(member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (err) {
      alert(`${t('team.errors.remove')} ${(err as Error).message}`);
    }
  };

  const startEditing = (member: LabMember) => {
    setEditForm({
      firstName: member.firstName ?? '',
      lastName: member.lastName ?? '',
      email: member.email,
    });
    setEditingId(member.userId);
    setActionError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      setSaving(true);
      setActionError(null);
      await labApi.users.update(
        editingId,
        editForm as unknown as Record<string, unknown>
      );
      setEditingId(null);
      loadMembers(false);
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
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as LabRole })
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
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEdit}
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
                    <div className="flex items-center gap-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-700 text-sm font-semibold text-white">
                        {(
                          member.firstName?.[0] ?? member.email[0]
                        ).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {displayName}
                          {isMe && (
                            <span className="ml-2 text-xs text-gray-500">
                              ({t('team.you')})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {!isMe && isAdmin && (
                        <>
                          <button
                            onClick={() => startEditing(member)}
                            className="rounded-lg p-1.5 text-cyan hover:bg-gray-800"
                            title={t('team.edit')}
                          >
                            <i className="fa-solid fa-pen text-sm" />
                          </button>
                          <button
                            onClick={() => handleRemove(member)}
                            className="rounded-lg p-1.5 text-red-400 hover:bg-red-900/20"
                            title={t('team.remove.button')}
                          >
                            <i className="fa-solid fa-trash-can text-sm" />
                          </button>
                        </>
                      )}

                      {isMe || !isAdmin ? (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
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
