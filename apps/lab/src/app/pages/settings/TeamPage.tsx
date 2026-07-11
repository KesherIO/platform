import { useEffect, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { labApi } from '../../shared/api/labApi';
import type { LabMember, LabRole } from '../../types/lab.types';

const ROLES: LabRole[] = ['ADMIN', 'TECHNICIAN', 'VET', 'RECEPTIONIST'];

const ROLE_COLORS: Record<LabRole, string> = {
  ADMIN:        'bg-purple/20 text-purple',
  TECHNICIAN:   'bg-cyan/20 text-cyan',
  VET:          'bg-blue-900/40 text-blue-300',
  RECEPTIONIST: 'bg-gray-800 text-gray-400',
};

interface CreateForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: LabRole;
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
  const { user } = useAuth();

  const [members, setMembers] = useState<LabMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadMembers = () => {
    setLoading(true);
    setError(null);
    labApi.users
      .list()
      .then((data) => setMembers(data as LabMember[]))
      .catch(() => setError(t('team.errors.load')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadMembers(); }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await labApi.users.create(form as unknown as Record<string, unknown>);
      setShowForm(false);
      setForm(EMPTY_FORM);
      loadMembers();
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
        prev.map((m) => (m.userId === userId ? { ...m, role: role as LabRole } : m))
      );
    } catch {
      // role change failed — reload to show correct state
      loadMembers();
    }
  };

  const handleRemove = async (member: LabMember) => {
    const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email;
    if (!confirm(t('team.remove.confirm', { name }))) return;
    try {
      await labApi.users.remove(member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (err) {
      alert(`${t('team.errors.remove')} ${(err as Error).message}`);
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
        <button
          onClick={() => { setShowForm(true); setFormError(null); }}
          className="rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-gray-950 hover:opacity-90"
        >
          + {t('team.add_user')}
        </button>
      </div>

      {/* Add user form */}
      {showForm && (
        <div className="mb-6 rounded-xl border border-gray-700 bg-gray-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">{t('team.form.title')}</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  {t('team.form.first_name')}
                </label>
                <input
                  required
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
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
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
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
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">{t('team.form.password_hint')}</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                {t('team.form.role')}
              </label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as LabRole })}
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
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                className="rounded-lg border border-gray-700 px-5 py-2 text-sm text-gray-300 hover:bg-gray-800"
              >
                {t('team.form.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Members list */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {!loading && !error && members.length === 0 && (
        <div className="py-16 text-center text-gray-500">{t('team.empty')}</div>
      )}

      {!loading && !error && members.length > 0 && (
        <div className="space-y-2">
          {members.map((member) => {
            const isMe = member.userId === user?.id;
            const displayName =
              [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email;

            return (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-700 text-sm font-semibold text-white">
                    {(member.firstName?.[0] ?? member.email[0]).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {displayName}
                      {isMe && (
                        <span className="ml-2 text-xs text-gray-500">({t('team.you')})</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">{member.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Role selector — disabled for self */}
                  {isMe ? (
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${ROLE_COLORS[member.role]}`}>
                      {t(`team.roles.${member.role}`)}
                    </span>
                  ) : (
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-white focus:border-cyan focus:outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`team.roles.${r}`)}
                        </option>
                      ))}
                    </select>
                  )}

                  {!isMe && (
                    <button
                      onClick={() => handleRemove(member)}
                      className="rounded-lg border border-red-900/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20"
                    >
                      {t('team.remove.button')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
