import { useEffect, useRef, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';

/**
 * Asks for the reason behind a membership change (stored in the audit log).
 * `onSubmit` errors are shown inline and keep the dialog open.
 */
export function ReasonDialog({
  title,
  message,
  confirmLabel,
  required,
  destructive = false,
  icon: Icon,
  onSubmit,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  required: boolean;
  destructive?: boolean;
  icon?: LucideIcon;
  onSubmit: (reason: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [submitting, onCancel]);

  const trimmed = reason.trim();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (required && !trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-dialog-title"
        className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
      >
        <div className="flex items-start gap-4">
          {Icon && (
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                destructive
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-cyan/10 text-cyan'
              }`}
            >
              <Icon size={20} strokeWidth={2} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2
              id="reason-dialog-title"
              className="text-base font-semibold text-white"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-gray-400">{message}</p>
          </div>
        </div>

        <label className="mt-5 block text-xs font-medium text-gray-400">
          {required ? t('team.reason.label') : t('team.reason.label_optional')}
        </label>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          required={required}
          placeholder={t('team.reason.placeholder')}
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-cyan focus:outline-none"
        />

        {error && (
          <p className="mt-3 rounded-lg bg-red-900/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || (required && !trimmed)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              destructive
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-cyan text-gray-950 hover:opacity-90'
            }`}
          >
            {submitting && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
