import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { labApi } from '../../shared/api/labApi';

interface LabMember {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface ReassignModalProps {
  testId: string;
  currentAssigneeId: string | null;
  version: number;
  onClose: () => void;
  onReassigned: () => void;
}

const ELIGIBLE_ROLES = new Set(['TECHNICIAN', 'ADMIN', 'OWNER']);

export function ReassignModal({
  testId,
  currentAssigneeId,
  version,
  onClose,
  onReassigned,
}: ReassignModalProps) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<LabMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    labApi.users
      .list()
      .then((data) => {
        const eligible = (data as LabMember[]).filter(
          (m) => ELIGIBLE_ROLES.has(m.role) && m.id !== currentAssigneeId
        );
        setMembers(eligible);
      })
      .catch(() => setError(t('worklist.errors.reassign')))
      .finally(() => setLoading(false));
  }, [currentAssigneeId, t]);

  async function handleSubmit() {
    if (!selectedId) return;
    setSubmitting(true);
    setError('');
    try {
      await labApi.worklist.reassign(testId, selectedId, version);
      onReassigned();
    } catch {
      setError(t('worklist.errors.reassign'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {t('worklist.reassign_modal.title')}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-gray-800"
              />
            ))}
          </div>
        )}

        {!loading && members.length === 0 && (
          <p className="py-4 text-center text-sm text-gray-400">
            {t('worklist.reassign_modal.no_technicians')}
          </p>
        )}

        {!loading && members.length > 0 && (
          <div className="mb-4 max-h-60 space-y-1 overflow-y-auto">
            <p className="mb-2 text-sm text-gray-400">
              {t('worklist.reassign_modal.select_technician')}
            </p>
            {members.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                  selectedId === m.id
                    ? 'border-cyan/40 bg-cyan/5'
                    : 'border-gray-800 hover:bg-gray-800'
                }`}
              >
                <input
                  type="radio"
                  name="target-user"
                  value={m.id}
                  checked={selectedId === m.id}
                  onChange={() => setSelectedId(m.id)}
                  className="accent-cyan"
                />
                <span className="text-sm text-white">
                  {m.firstName} {m.lastName}
                </span>
                <span className="text-xs text-gray-500">{m.role}</span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedId || submitting}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-gray-950 hover:bg-cyan/90 disabled:opacity-50"
          >
            {submitting
              ? t('worklist.reassign_modal.reassigning')
              : t('worklist.reassign_modal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
