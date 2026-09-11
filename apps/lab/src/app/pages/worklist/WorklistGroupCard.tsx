import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../shared/components/StatusBadge';
import type { WorklistItem } from '../../types/lab.types';

const PRIORITY_COLORS: Record<string, string> = {
  STAT: 'bg-red-500/20 text-red-400 border-red-500/30',
  URGENT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  ROUTINE: 'bg-gray-800 text-gray-400 border-gray-700',
};

function formatWaitingSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function aggregateStatus(items: WorklistItem[]): string {
  const statuses = new Set(items.map((i) => i.status));
  if (statuses.size === 1) return items[0].status;
  return 'MIXED';
}

interface WorklistGroupCardProps {
  packageName: string;
  items: WorklistItem[];
  currentUserId: string;
  isAdmin: boolean;
  onClaimAll: (items: WorklistItem[]) => void;
  onUnclaimAll: (items: WorklistItem[]) => void;
  onStartAll: (items: WorklistItem[]) => void;
  onReassign: (testId: string) => void;
  busy: boolean;
}

export function WorklistGroupCard({
  packageName,
  items,
  currentUserId,
  isAdmin,
  onClaimAll,
  onUnclaimAll,
  onStartAll,
  onReassign,
  busy,
}: WorklistGroupCardProps) {
  const { t } = useTranslation();

  const first = items[0];
  const aggStatus = aggregateStatus(items);
  const allMine = items.every((i) => i.assignedUserId === currentUserId);
  const allUnassigned = items.every((i) => !i.assignedUserId);
  const someAssigned = items.some((i) => i.assignedUserId);

  const canClaimAll = allUnassigned && items.every((i) => i.status === 'READY');
  const canStartAll = allMine && items.every((i) => i.status === 'READY');
  const canEnterResults =
    allMine && items.every((i) => i.status === 'IN_PROGRESS');
  const canUnclaimAll = someAssigned && (allMine || isAdmin);
  const canReassign =
    isAdmin &&
    items.every((i) => i.status === 'READY' || i.status === 'IN_PROGRESS');

  const earliestCreated = items.reduce(
    (earliest, i) => (i.createdAt < earliest ? i.createdAt : earliest),
    items[0].createdAt
  );

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      {/* Row 1: priority, accession, status, wait time */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${
              PRIORITY_COLORS[first.orderPriority] ?? PRIORITY_COLORS.ROUTINE
            }`}
          >
            {first.orderPriority}
          </span>
          {first.accessionNumber && (
            <span className="text-xs text-gray-400">
              {first.accessionNumber}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {aggStatus === 'MIXED' ? (
            <span className="rounded-full border border-yellow-600/30 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
              {t('worklist.card.package_status_mixed')}
            </span>
          ) : (
            <StatusBadge status={aggStatus} size="sm" />
          )}
          <span className="text-xs text-gray-500">
            {t('worklist.card.waiting')} {formatWaitingSince(earliestCreated)}
          </span>
        </div>
      </div>

      {/* Row 2: patient info */}
      <div className="mb-1">
        <Link
          to={`/orders/${first.orderId}`}
          className="text-sm font-medium text-white hover:text-cyan"
        >
          {first.patientName}
        </Link>
        <span className="mx-1.5 text-gray-600">&middot;</span>
        <span className="text-sm text-gray-400">{first.patientSpecies}</span>
        <span className="mx-1.5 text-gray-600">&middot;</span>
        <span className="text-sm text-gray-400">{first.ownerName}</span>
      </div>

      {/* Row 3: package info */}
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-300">
        <span className="font-medium">{packageName}</span>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {t('worklist.card.package_tests', { count: items.length })}
        </span>
      </div>

      {/* Row 3.5: component test names */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item.id}
            className="rounded border border-gray-700/50 bg-gray-800/50 px-1.5 py-0.5 text-xs text-gray-400"
          >
            {item.catalogItemCode ?? item.catalogItemName}
          </span>
        ))}
      </div>

      {/* Row 4: assignment + clinic + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {allMine ? (
            <span>
              {t('worklist.card.assigned_to')}{' '}
              <span className="text-gray-200">{items[0].assignedUserName}</span>
            </span>
          ) : allUnassigned ? (
            <span className="text-yellow-400/80">
              {t('worklist.card.unassigned')}
            </span>
          ) : (
            <span className="text-yellow-400/80">
              {t('worklist.card.package_status_mixed')}
            </span>
          )}
          <span className="text-gray-600">&middot;</span>
          <span>{first.clinicName}</span>
          <span className="text-gray-600">&middot;</span>
          <span>{first.requisitionNumber}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {canClaimAll && (
            <button
              onClick={() => onClaimAll(items)}
              disabled={busy}
              className="rounded-md bg-cyan/15 px-2.5 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/25 disabled:opacity-50"
            >
              {t('worklist.actions.claim_all')}
            </button>
          )}
          {canStartAll && (
            <button
              onClick={() => onStartAll(items)}
              disabled={busy}
              className="rounded-md bg-green-500/15 px-2.5 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/25 disabled:opacity-50"
            >
              {t('worklist.actions.start_all')}
            </button>
          )}
          {canEnterResults && (
            <Link
              to={`/orders/${first.orderId}/batch-results?packageOriginId=${first.packageOriginId}`}
              className="rounded-md bg-purple px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              {t('worklist.actions.enter_all_results')}
            </Link>
          )}
          {canUnclaimAll && (
            <button
              onClick={() => onUnclaimAll(items)}
              disabled={busy}
              className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {t('worklist.actions.unclaim')}
            </button>
          )}
          {canReassign && (
            <button
              onClick={() => onReassign(first.id)}
              disabled={busy}
              className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {t('worklist.actions.reassign')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
