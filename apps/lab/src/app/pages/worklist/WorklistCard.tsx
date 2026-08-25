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

interface WorklistCardProps {
  item: WorklistItem;
  currentUserId: string;
  isAdmin: boolean;
  onClaim: (testId: string, version: number) => void;
  onUnclaim: (testId: string) => void;
  onStart: (testId: string) => void;
  onReassign: (testId: string) => void;
  busy: boolean;
}

export function WorklistCard({
  item,
  currentUserId,
  isAdmin,
  onClaim,
  onUnclaim,
  onStart,
  onReassign,
  busy,
}: WorklistCardProps) {
  const { t } = useTranslation();

  const isMine = item.assignedUserId === currentUserId;
  const isUnassigned = !item.assignedUserId;
  const canClaim = isUnassigned && item.status === 'READY';
  const canStart = isMine && item.status === 'READY';
  const canUnclaim = item.assignedUserId && (isMine || isAdmin);
  const canReassign =
    isAdmin && (item.status === 'READY' || item.status === 'IN_PROGRESS');
  const canEnterResults = isMine && item.status === 'IN_PROGRESS';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      {/* Row 1: priority, accession, status, wait time */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${
              PRIORITY_COLORS[item.orderPriority] ?? PRIORITY_COLORS.ROUTINE
            }`}
          >
            {item.orderPriority}
          </span>
          {item.accessionNumber && (
            <span className="text-xs text-gray-400">
              {item.accessionNumber}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} size="sm" />
          <span className="text-xs text-gray-500">
            {t('worklist.card.waiting')} {formatWaitingSince(item.createdAt)}
          </span>
        </div>
      </div>

      {/* Row 2: patient info */}
      <div className="mb-1">
        <Link
          to={`/orders/${item.orderId}`}
          className="text-sm font-medium text-white hover:text-cyan"
        >
          {item.patientName}
        </Link>
        <span className="mx-1.5 text-gray-600">&middot;</span>
        <span className="text-sm text-gray-400">{item.patientSpecies}</span>
        <span className="mx-1.5 text-gray-600">&middot;</span>
        <span className="text-sm text-gray-400">{item.ownerName}</span>
      </div>

      {/* Row 3: test info */}
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-300">
        <span className="font-medium">{item.catalogItemName}</span>
        {item.catalogItemCode && (
          <span className="text-gray-500">({item.catalogItemCode})</span>
        )}
        {item.processingMethod && (
          <>
            <span className="text-gray-600">&middot;</span>
            <span className="text-gray-400">
              {item.processingMethod === 'MANUAL'
                ? t('worklist.card.method_manual')
                : t('worklist.card.method_analyzer')}
            </span>
          </>
        )}
        {item.analyzerName && (
          <>
            <span className="text-gray-600">&middot;</span>
            <span className="text-gray-400">{item.analyzerName}</span>
          </>
        )}
      </div>

      {/* Row 4: assignment + clinic + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {item.assignedUserName ? (
            <span>
              {t('worklist.card.assigned_to')}{' '}
              <span className="text-gray-200">{item.assignedUserName}</span>
            </span>
          ) : (
            <span className="text-yellow-400/80">
              {t('worklist.card.unassigned')}
            </span>
          )}
          <span className="text-gray-600">&middot;</span>
          <span>{item.clinicName}</span>
          <span className="text-gray-600">&middot;</span>
          <span>{item.requisitionNumber}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {canClaim && (
            <button
              onClick={() => onClaim(item.id, item.version)}
              disabled={busy}
              className="rounded-md bg-cyan/15 px-2.5 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/25 disabled:opacity-50"
            >
              {t('worklist.actions.claim')}
            </button>
          )}
          {canStart && (
            <button
              onClick={() => onStart(item.id)}
              disabled={busy}
              className="rounded-md bg-green-500/15 px-2.5 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/25 disabled:opacity-50"
            >
              {t('worklist.actions.start')}
            </button>
          )}
          {canEnterResults && (
            <Link
              to={`/orders/${item.orderId}/tests/${item.id}/results`}
              className="rounded-md bg-purple-500/15 px-2.5 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-500/25"
            >
              {t('worklist.actions.enter_results')}
            </Link>
          )}
          {canUnclaim && (
            <button
              onClick={() => onUnclaim(item.id)}
              disabled={busy}
              className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {t('worklist.actions.unclaim')}
            </button>
          )}
          {canReassign && (
            <button
              onClick={() => onReassign(item.id)}
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
