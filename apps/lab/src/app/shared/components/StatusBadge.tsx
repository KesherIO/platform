import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-900/50 text-yellow-300',
  READY_FOR_PICKUP: 'bg-blue-900/50 text-blue-300',
  COLLECTED: 'bg-indigo-900/50 text-indigo-300',
  RECEIVED_BY_LAB: 'bg-purple-900/50 text-purple-300',
  PROCESSING: 'bg-orange-900/50 text-orange-300',
  COMPLETED: 'bg-green-900/50 text-green-300',
  CANCELLED: 'bg-gray-800 text-gray-400',
  IN_PROGRESS: 'bg-orange-900/50 text-orange-300',
  DRAFT: 'bg-yellow-900/50 text-yellow-300',
  RELEASED: 'bg-green-900/50 text-green-300',
};

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const { t } = useTranslation();
  const colorClass = STATUS_COLORS[status] ?? 'bg-gray-800 text-gray-400';
  const label = t(`status.${status}`, { defaultValue: status });
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${colorClass} ${sizeClass}`}
    >
      {label}
    </span>
  );
}
