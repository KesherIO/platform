import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labApi } from '../api/labApi';
import type {
  AttentionSeverity,
  KnowledgeSearchResult,
  OrderAttention,
  Species,
} from '../../types/lab.types';

type View =
  | 'suggestions'
  | 'attention'
  | 'delayed'
  | 'knowledge-form'
  | 'knowledge-results';

const SEVERITY_DOT: Record<AttentionSeverity, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-500',
};

const SPECIES_OPTIONS: Species[] = [
  'DOG',
  'CAT',
  'EQUINE',
  'BOVINE',
  'BIRD',
  'REPTILE',
  'RABBIT',
  'OTHER',
];

const DELAYED_REASON_PREFIX = 'SLA_BREACH_';

interface LabAssistantPanelProps {
  onClose: () => void;
}

export function LabAssistantPanel({ onClose }: LabAssistantPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('suggestions');

  const [attentionOrders, setAttentionOrders] = useState<
    OrderAttention[] | null
  >(null);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [attentionError, setAttentionError] = useState<string | null>(null);

  const [species, setSpecies] = useState<Species | ''>('');
  const [symptoms, setSymptoms] = useState('');
  const [knowledgeResults, setKnowledgeResults] = useState<
    KnowledgeSearchResult[] | null
  >(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  function openAttention(nextView: 'attention' | 'delayed') {
    setView(nextView);
    if (attentionOrders !== null) return; // both views share one fetch
    setAttentionLoading(true);
    setAttentionError(null);
    labApi.assistant
      .ordersNeedingAttention()
      .then(setAttentionOrders)
      .catch((err: Error) => setAttentionError(err.message))
      .finally(() => setAttentionLoading(false));
  }

  function submitKnowledgeSearch(e: FormEvent) {
    e.preventDefault();
    if (!species) return;
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    labApi.assistant
      .searchKnowledge({ species, symptoms: symptoms.trim() || undefined })
      .then((results) => {
        setKnowledgeResults(results);
        setView('knowledge-results');
      })
      .catch((err: Error) => setKnowledgeError(err.message))
      .finally(() => setKnowledgeLoading(false));
  }

  const delayedOrders = (attentionOrders ?? []).filter((order) =>
    order.attentionReasons.some((r) => r.code.startsWith(DELAYED_REASON_PREFIX))
  );

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <h2 className="flex items-center font-bold text-white">
          {view !== 'suggestions' && (
            <button
              onClick={() => setView('suggestions')}
              className="mr-2 text-sm font-normal text-gray-400 hover:text-white"
            >
              {t('assistant.back')}
            </button>
          )}
          {t('assistant.title')}
        </h2>
        <button
          onClick={onClose}
          aria-label={t('assistant.close')}
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {view === 'suggestions' && (
          <div className="space-y-2">
            <p className="mb-2 text-sm text-gray-400">
              {t('assistant.prompt')}
            </p>
            <SuggestionButton
              label={t('assistant.suggestions.attention')}
              onClick={() => openAttention('attention')}
            />
            <SuggestionButton
              label={t('assistant.suggestions.delayed')}
              onClick={() => openAttention('delayed')}
            />
            <SuggestionButton
              label={t('assistant.suggestions.knowledge')}
              onClick={() => setView('knowledge-form')}
            />
          </div>
        )}

        {(view === 'attention' || view === 'delayed') && (
          <AttentionList
            orders={
              view === 'attention' ? attentionOrders ?? [] : delayedOrders
            }
            loading={attentionLoading}
            error={attentionError}
            emptyKey={
              view === 'attention'
                ? 'assistant.attention_empty'
                : 'assistant.delayed_empty'
            }
            summaryKey={
              view === 'attention'
                ? 'assistant.attention_summary'
                : 'assistant.delayed_summary'
            }
          />
        )}

        {view === 'knowledge-form' && (
          <form onSubmit={submitKnowledgeSearch} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-gray-400">
                {t('assistant.knowledge_form.species')}
              </label>
              <select
                value={species}
                onChange={(e) => setSpecies(e.target.value as Species)}
                required
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              >
                <option value="" disabled>
                  {t('assistant.knowledge_form.species_placeholder')}
                </option>
                {SPECIES_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`species.${s}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm text-gray-400">
                {t('assistant.knowledge_form.symptoms')}
              </label>
              <textarea
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder={t('assistant.knowledge_form.symptoms_placeholder')}
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
              />
            </div>

            {knowledgeError && (
              <p className="text-sm text-red-300">
                {t('assistant.error')} {knowledgeError}
              </p>
            )}

            <button
              type="submit"
              disabled={knowledgeLoading || !species}
              className="w-full rounded-lg bg-cyan/10 px-4 py-2 text-sm font-medium text-cyan transition hover:bg-cyan/20 disabled:opacity-50"
            >
              {knowledgeLoading
                ? t('assistant.loading')
                : t('assistant.knowledge_form.submit')}
            </button>
          </form>
        )}

        {view === 'knowledge-results' && (
          <div className="space-y-3">
            {(knowledgeResults ?? []).length === 0 && (
              <p className="py-8 text-center text-gray-500">
                {t('assistant.knowledge_empty')}
              </p>
            )}
            {(knowledgeResults ?? []).map((result) => (
              <div
                key={result.id}
                className="rounded-xl border border-gray-800 bg-gray-950 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">
                    {result.documentTitle}
                  </p>
                  <span className="shrink-0 text-xs text-gray-500">
                    {t('assistant.relevance')}{' '}
                    {(result.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-gray-500">{result.section}</p>
                <p className="mt-1 text-sm text-gray-300">{result.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SuggestionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-gray-800 bg-gray-950 px-4 py-2.5 text-left text-sm text-gray-200 transition hover:border-cyan/40 hover:text-cyan"
    >
      {label}
    </button>
  );
}

function AttentionList({
  orders,
  loading,
  error,
  emptyKey,
  summaryKey,
}: {
  orders: OrderAttention[];
  loading: boolean;
  error: string | null;
  emptyKey: string;
  summaryKey: string;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-300">
        {t('assistant.error')} {error}
      </p>
    );
  }

  if (orders.length === 0) {
    return <p className="py-8 text-center text-gray-500">{t(emptyKey)}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">
        {t(summaryKey, { count: orders.length })}
      </p>
      {orders.map((order) => (
        <div
          key={order.orderId}
          className="rounded-xl border border-gray-800 bg-gray-950 p-3"
        >
          <div className="flex items-start gap-2">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                SEVERITY_DOT[order.severity]
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">
                {order.patientName}{' '}
                <span className="font-mono text-xs text-gray-500">
                  {order.requisitionNumber}
                </span>
              </p>
              {order.attentionReasons.map((reason) => (
                <p key={reason.code} className="mt-0.5 text-sm text-gray-400">
                  {reason.message}
                </p>
              ))}
              <Link
                to={`/orders/${order.orderId}`}
                className="mt-2 inline-block text-sm text-cyan hover:underline"
              >
                {t('assistant.open_order')}
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
