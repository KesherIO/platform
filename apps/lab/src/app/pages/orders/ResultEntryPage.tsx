import { useEffect, useState, useCallback, FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import type { OrderedTest, LabOrderDetail } from '../../types/lab.types';

export function ResultEntryPage() {
  const { orderId, testId } = useParams<{ orderId: string; testId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [test, setTest] = useState<OrderedTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entryMethod, setEntryMethod] = useState('MANUAL');

  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const order = await labApi.orders.getById(orderId) as LabOrderDetail;
      const found = order.orderedTests.find((t) => t.id === testId);
      if (found) {
        setTest(found);
        setEntryMethod(found.entryMethod);
      }
    } finally {
      setLoading(false);
    }
  }, [orderId, testId]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  const handleStartTest = async (e: FormEvent) => {
    e.preventDefault();
    if (!testId) return;
    setSaving(true);
    try {
      await labApi.orderedTests.update(testId, { status: 'IN_PROGRESS', entryMethod });
      await loadOrder();
    } finally {
      setSaving(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!testId) return;
    setSaving(true);
    try {
      await labApi.orderedTests.update(testId, { status: 'COMPLETED' });
      navigate(`/orders/${orderId}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  if (!test) {
    return <div className="p-6 text-red-400">{t('result_entry.not_found')}</div>;
  }

  const entryMethodLabel =
    test.entryMethod === 'MANUAL' ? t('result_entry.manual_label') : test.entryMethod.toLowerCase();

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link to={`/orders/${orderId}`} className="text-sm text-gray-400 hover:text-white">
          {t('result_entry.back')}
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-bold text-white">{test.catalogItemName}</h1>
      {test.catalogItemCode && (
        <p className="mb-6 font-mono text-sm text-gray-400">{test.catalogItemCode}</p>
      )}

      <div className="max-w-lg rounded-xl border border-gray-800 bg-gray-900 p-6">
        {test.status === 'PENDING' && (
          <form onSubmit={handleStartTest} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                {t('result_entry.entry_method')}
              </label>
              <select
                value={entryMethod}
                onChange={(e) => setEntryMethod(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-cyan focus:outline-none"
              >
                <option value="MANUAL">{t('result_entry.manual')}</option>
                <option value="INSTRUMENT">{t('result_entry.instrument')}</option>
                <option value="IMPORTED">{t('result_entry.imported')}</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-cyan px-4 py-2.5 font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t('result_entry.starting') : t('result_entry.start')}
            </button>
          </form>
        )}

        {test.status === 'IN_PROGRESS' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              {t('result_entry.in_progress_via')}{' '}
              <span className="font-semibold text-white">{entryMethodLabel}</span>.
            </p>
            <p className="text-sm text-gray-400">{t('result_entry.in_progress_note')}</p>
            <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 px-4 py-3">
              <p className="text-sm text-yellow-300">{t('result_entry.report_hint')}</p>
            </div>
            <button
              onClick={handleMarkComplete}
              disabled={saving}
              className="w-full rounded-lg bg-green-600 px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t('result_entry.saving') : t('result_entry.mark_complete')}
            </button>
          </div>
        )}

        {(test.status === 'COMPLETED' || test.status === 'CANCELLED') && (
          <p className="text-sm text-gray-400">
            {t('result_entry.already_done', {
              status: t(`result_entry.status_${test.status.toLowerCase()}`),
            })}
          </p>
        )}
      </div>
    </div>
  );
}
