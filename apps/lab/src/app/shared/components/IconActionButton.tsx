import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface IconActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: 'neutral' | 'danger';
  disabled?: boolean;
}

const VARIANT_CLASSES: Record<'neutral' | 'danger', string> = {
  neutral: 'text-gray-400 hover:text-cyan hover:bg-cyan/10',
  danger: 'text-gray-400 hover:text-amber-400 hover:bg-amber-400/10',
};

export function IconActionButton({
  icon: Icon,
  label,
  onClick,
  variant = 'neutral',
  disabled = false,
}: IconActionButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]}`}
      >
        <Icon size={18} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}
