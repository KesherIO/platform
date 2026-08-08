import { useTranslation } from 'react-i18next';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-400/15 text-yellow-300',
  READY_FOR_PICKUP: 'bg-blue-400/15 text-blue-300',
  COLLECTED: 'bg-indigo-400/15 text-indigo-300',
  RECEIVED_BY_LAB: 'bg-emerald-400/15 text-emerald-300',
  PROCESSING: 'bg-orange-400/15 text-orange-300',
  COMPLETED: 'bg-green-400/15 text-green-300',
  CANCELLED: 'bg-gray-400/15 text-gray-400',
  IN_PROGRESS: 'bg-orange-400/15 text-orange-300',
  DRAFT: 'bg-yellow-400/15 text-yellow-300',
  RELEASED: 'bg-green-400/15 text-green-300',
  // Pickup statuses
  REQUESTED: 'bg-yellow-400/15 text-yellow-300',
  ASSIGNED: 'bg-blue-400/15 text-blue-300',
  NOTIFIED: 'bg-indigo-400/15 text-indigo-300',
  ACCEPTED: 'bg-cyan/15 text-cyan',
  IN_TRANSIT: 'bg-orange-400/15 text-orange-300',
  RECEIVED_AT_LAB: 'bg-green-400/15 text-green-300',
  FAILED: 'bg-red-400/15 text-red-300',
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
