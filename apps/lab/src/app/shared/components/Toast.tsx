import { CheckCircle2, XCircle, Info, X, LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: LucideIcon; classes: string }
> = {
  success: {
    icon: CheckCircle2,
    classes: 'border-green-800/50 bg-green-900/30 text-green-300',
  },
  error: {
    icon: XCircle,
    classes: 'border-red-800/50 bg-red-900/30 text-red-300',
  },
  info: {
    icon: Info,
    classes: 'border-gray-700 bg-gray-800 text-gray-200',
  },
};

interface ToastProps {
  toast: ToastItem;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const { t } = useTranslation();
  const { icon: Icon, classes } = VARIANT_STYLES[toast.variant];

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      className={`flex w-80 items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${classes}`}
    >
      <Icon size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('common.dismiss')}
        className="shrink-0 rounded text-current opacity-70 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
